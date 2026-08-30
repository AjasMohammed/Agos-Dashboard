import { create } from "zustand";
import { chatKeys, streamChatMessage } from "@/api/queries/chat";
import { toastError } from "@/lib/errors";
import { queryClient } from "@/lib/query";

/**
 * In-flight chat streams live HERE, not in the Conversation component. Leaving
 * the page (or switching sessions) mid-reply used to unmount that state and
 * abort the fetch, throwing away a half-streamed answer that the server never
 * got to persist. Module scope survives unmount: the stream keeps running and
 * the partial reply is still on screen when you come back.
 */
export interface ChatStream {
  user: string;
  assistant: string;
  /** `taskId` = the per-turn chat task the call runs under (absent for gateway calls). */
  tools: { name: string; success?: boolean; taskId?: string }[];
}

interface StreamStore {
  /** sessionId -> in-flight stream */
  streams: Record<string, ChatStream>;
  /** sessionId -> text of a send that failed, for the composer to restore */
  failed: Record<string, string>;
}

export const useChatStreamStore = create<StreamStore>(() => ({ streams: {}, failed: {} }));

/**
 * Abort a stream when no BYTES arrive for this long (re-armed via onActivity on
 * every read, so thinking events and keepalives count as liveness). Catches
 * genuinely dead connections — a proxy drop with no error frame — which
 * otherwise leave the composer disabled forever.
 */
const STREAM_IDLE_MS = 120_000;

/**
 * Give up waiting on the handover refetch after this long. The query client runs
 * at the default `networkMode: "online"`, which PAUSES a refetch while the
 * browser is offline — that promise never settles, so `.finally` never runs.
 * Without this the stream entry would stay in the store forever: composer
 * disabled, Stop button up, and the idle watchdog already cleared.
 */
const SETTLE_DEADLINE_MS = 15_000;

const controllers = new Map<string, AbortController>();

function patch(sessionId: string, fn: (s: ChatStream) => ChatStream) {
  useChatStreamStore.setState((st) => {
    const cur = st.streams[sessionId];
    return cur ? { streams: { ...st.streams, [sessionId]: fn(cur) } } : st;
  });
}

function drop(map: Record<string, unknown>, key: string) {
  const next = { ...map };
  delete next[key];
  return next;
}

function finish(sessionId: string) {
  controllers.delete(sessionId);
  useChatStreamStore.setState((st) =>
    sessionId in st.streams
      ? { streams: drop(st.streams, sessionId) as Record<string, ChatStream> }
      : st,
  );
}

/**
 * Hand the turn over from the live bubble to the persisted transcript.
 *
 * Order matters: drop the bubble only once the refetched transcript is in hand
 * — clearing first leaves a gap where the reply exists in neither place and the
 * answer visibly vanishes for a round trip (and never comes back if the turn
 * was not persisted). `.finally`, not `.then`, so a failed refetch still
 * releases the composer. The sessions key is a different query: invalidated
 * after, and not awaited, since it only reorders the rail.
 *
 * A refetch can also never settle at all (see {@link SETTLE_DEADLINE_MS}), so
 * the wait is bounded. `finish` is idempotent — whichever path gets there first
 * wins and the other is a no-op.
 */
function settle(sessionId: string) {
  const bail = setTimeout(() => finish(sessionId), SETTLE_DEADLINE_MS);
  void queryClient
    .invalidateQueries({ queryKey: chatKeys.messages(sessionId) })
    .finally(() => {
      clearTimeout(bail);
      finish(sessionId);
    })
    // A rejected invalidation is the query's own problem to report; swallowing
    // it here only stops an unhandled rejection from the `.finally` chain.
    .catch(() => {});
  queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
}

/** Start streaming a reply. No-op if this session already has one in flight. */
export function startChatStream(sessionId: string, text: string) {
  if (useChatStreamStore.getState().streams[sessionId]) return;
  useChatStreamStore.setState((st) => ({
    streams: { ...st.streams, [sessionId]: { user: text, assistant: "", tools: [] } },
    failed: drop(st.failed, sessionId) as Record<string, string>,
  }));

  const controller = new AbortController();
  controllers.set(sessionId, controller);

  // Watchdog: a dropped connection can end the stream without a done/error
  // frame, which would leave the entry set (composer disabled) forever.
  // Re-armed on every event; on firing it does exactly what onError does.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    // `fail` aborts the controller itself, which is what clears this timer.
    idleTimer = setTimeout(
      () => fail(sessionId, text, "Stream stalled — connection lost"),
      STREAM_IDLE_MS,
    );
  };
  // Coalesce chunk writes onto a frame. `Markdown` re-parses the WHOLE reply on
  // every render, so writing per token is O(n²) parse work for a long answer —
  // and a paint can only ever show the last write in a frame anyway.
  let buffered = "";
  let frame: number | null = null;
  function flushChunks() {
    if (frame != null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    if (!buffered) return;
    const pending = buffered;
    buffered = "";
    patch(sessionId, (s) => ({ ...s, assistant: s.assistant + pending }));
  }

  controller.signal.addEventListener("abort", () => {
    if (idleTimer) clearTimeout(idleTimer);
    // Flush rather than discard: on Stop the buffered tail is text the reader
    // already watched arrive, and the pending frame must not outlive the stream.
    flushChunks();
  });
  armIdle();

  function fail(id: string, sent: string, message: string) {
    // Abort, don't merely clear the timer. Two things ride on it: a server
    // `error` event returns from the read loop leaving the response body
    // unread but OPEN (the lock is released, nothing cancels it), and the abort
    // listener is what cancels the pending frame — a queued flush that outlives
    // the stream would find whatever entry exists when it runs and prepend this
    // dead stream's tail to the NEXT reply in the same session.
    controller.abort();
    toastError(new Error(message));
    finish(id);
    useChatStreamStore.setState((st) => ({ failed: { ...st.failed, [id]: sent } }));
  }

  void streamChatMessage(
    sessionId,
    text,
    {
      onActivity: armIdle,
      onChunk: (chunk) => {
        buffered += chunk;
        frame ??= requestAnimationFrame(flushChunks);
      },
      onToolStart: (name, taskId) =>
        patch(sessionId, (s) => ({
          ...s,
          tools: [...s.tools, taskId ? { name, taskId } : { name }],
        })),
      onTool: (name, success) =>
        patch(sessionId, (s) => {
          // Settle the most recent still-running call for this tool.
          const tools = [...s.tools];
          for (let i = tools.length - 1; i >= 0; i--) {
            if (tools[i].name === name && tools[i].success === undefined) {
              tools[i] = { ...tools[i], success };
              return { ...s, tools };
            }
          }
          return { ...s, tools: [...tools, { name, success }] };
        }),
      onDone: () => {
        if (idleTimer) clearTimeout(idleTimer);
        // Before the handover, or a frame's worth of trailing tokens is dropped
        // on the floor between the last flush and the bubble going away.
        flushChunks();
        settle(sessionId);
      },
      onError: (msg) => fail(sessionId, text, msg),
    },
    controller.signal,
  );
}

/**
 * User pressed Stop. Dropping the response body cancels the server's streaming
 * future, so generation ends; refetch to pick up whatever the kernel persisted
 * before it did.
 */
export function stopChatStream(sessionId: string) {
  // The abort flushes any buffered tail into the bubble; `settle` keeps that
  // bubble on screen until the transcript replaces it (same as `onDone` — a
  // synchronous `finish` here blinked the whole reply out for one round trip).
  controllers.get(sessionId)?.abort();
  settle(sessionId);
}

/** Kill a stream for good (session deleted) — no toast, no text to restore. */
export function abortChatStream(sessionId: string) {
  controllers.get(sessionId)?.abort();
  finish(sessionId);
  // Parked retry text for a session that no longer exists would otherwise sit
  // in the store for the life of the tab, and land in the composer of whatever
  // chat is opened next.
  consumeFailedChatText(sessionId);
}

/** The composer took the parked text back; forget it. */
export function consumeFailedChatText(sessionId: string) {
  useChatStreamStore.setState((st) =>
    sessionId in st.failed ? { failed: drop(st.failed, sessionId) as Record<string, string> } : st,
  );
}
