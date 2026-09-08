import { create } from "zustand";
import { toast } from "sonner";
import { chatKeys, streamChatMessage, type StreamSummary } from "@/api/queries/chat";
import { toastError } from "@/lib/errors";
import { queryClient } from "@/lib/query";

/**
 * In-flight chat streams live HERE, not in the Conversation component. Leaving
 * the page (or switching sessions) mid-reply used to unmount that state and
 * abort the fetch, throwing away a half-streamed answer that the server never
 * got to persist. Module scope survives unmount: the stream keeps running and
 * the partial reply is still on screen when you come back.
 */

/**
 * One step of a turn, in the order the server emitted it.
 *
 * The kernel interleaves reasoning passes, tool calls and text: an answer can
 * be "think → call a tool → write a paragraph → call another tool → finish".
 * Holding tools in a separate array (as this store used to) flattened all of
 * that into "every tool, then all the text", which is not what happened and
 * reads as if the assistant ran everything up front.
 */
export type StreamPart =
  | { kind: "text"; text: string }
  /**
   * An inference pass. `text` is the model's reasoning, streamed by the kernel
   * as `Thinking { iteration, text }` deltas — absent on providers that expose
   * none, and on the pass marker that opens every iteration, so a thinking part
   * with no text is a labelled step and never fake prose.
   */
  | { kind: "thinking"; iteration: number; text?: string }
  | {
      kind: "tool";
      name: string;
      /** `taskId` = the per-turn chat task the call runs under (absent for gateway calls). */
      taskId?: string;
      /** `undefined` still running · `null` outcome never arrived · boolean settled. */
      success?: boolean | null;
      /** `result_preview` from the `tool_result` frame — the only view of what came back. */
      preview?: string;
      durationMs?: number;
    };

/** A pass that produced reasoning, kept past the handover. */
export interface ThoughtBlock {
  iteration: number;
  text: string;
}

export interface ChatStream {
  user: string;
  /** Everything the server said, in arrival order. */
  parts: StreamPart[];
  /**
   * Generation is over (done, stopped, or failed); the bubble only waits for
   * the transcript refetch to replace it. Not "in flight": a new send may
   * replace it.
   */
  done?: boolean;
  /**
   * The turn ended badly. Kept ON the stream rather than only toasted, so the
   * partial output stays readable and the failure is attached to the turn that
   * produced it instead of a notification that scrolls away.
   */
  error?: { message: string; detail?: string; at: number };
  /** Non-fatal protocol complaints, shown in the error card's details. */
  warnings?: string[];
  /** From the `done` frame: what the turn actually cost. */
  usage?: { iterations?: number; tokens?: number; costUsd?: number };
}

/** Tool calls of a turn, in order. */
export function streamTools(s: ChatStream) {
  return s.parts.filter((p): p is Extract<StreamPart, { kind: "tool" }> => p.kind === "tool");
}

/** Everything the assistant wrote, concatenated (for copy, and for dedupe checks). */
export function streamText(s: ChatStream) {
  return s.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
}

/**
 * The turn's reasoning, in order. Passes that emitted no text are skipped: the
 * marker only ever meant "a pass started", which the usage footer already says.
 */
export function streamThoughts(s: ChatStream | undefined): ThoughtBlock[] {
  return (s?.parts ?? []).flatMap((p) =>
    p.kind === "thinking" && p.text?.trim() ? [{ iteration: p.iteration, text: p.text }] : [],
  );
}

interface StreamStore {
  /** sessionId -> in-flight stream */
  streams: Record<string, ChatStream>;
  /**
   * sessionId -> what the newest finished turn cost. Kept separately from the
   * stream because the stream entry is dropped the moment the transcript takes
   * over, and `ApiChatMessage` carries no tokens/cost — so without this the
   * numbers the `done` frame reports would flash for one frame and be gone.
   */
  turnUsage: Record<string, NonNullable<ChatStream["usage"]>>;
  /**
   * sessionId -> the reasoning of the newest finished turn, for the same reason
   * as {@link StreamStore.turnUsage}: `ApiChatMessage` has no field for it, so
   * the moment the transcript takes over it would otherwise vanish — which is
   * exactly when the reader wants to go back and check the model's working.
   * Only passes that actually produced text are kept; a bare marker adds nothing
   * the transcript's own pass count doesn't already say.
   */
  turnThinking: Record<string, ThoughtBlock[]>;
  /** sessionId -> text of a send that failed, for the composer to restore */
  failed: Record<string, string>;
  /**
   * sessionId -> when that send failed. The composer restores parked text only
   * once the transcript has been refetched after this moment: the kernel
   * persists the user turn before inference, so if the turn is already there,
   * restoring it would make the next send a duplicate.
   */
  failedAt: Record<string, number>;
}

export const useChatStreamStore = create<StreamStore>(() => ({
  streams: {},
  turnUsage: {},
  turnThinking: {},
  failed: {},
  failedAt: {},
}));

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

/** Append text, merging into the trailing text part so markdown stays one block. */
function appendText(parts: StreamPart[], text: string): StreamPart[] {
  const last = parts[parts.length - 1];
  if (last?.kind === "text") {
    return [...parts.slice(0, -1), { kind: "text", text: last.text + text }];
  }
  return [...parts, { kind: "text", text }];
}

/**
 * Fold one reasoning delta (or, with empty `text`, the pass marker that opens
 * an iteration) into the tail.
 */
function appendThinking(parts: StreamPart[], iteration: number, text: string): StreamPart[] {
  const last = parts[parts.length - 1];
  if (last?.kind === "thinking" && last.iteration === iteration) {
    // Empty text is the marker arriving for a pass that already has a block —
    // stacking a second identical step would just look like a stutter.
    if (!text) return parts;
    return [...parts.slice(0, -1), { ...last, text: (last.text ?? "") + text }];
  }
  // A new pass, or something landed in between (a tool call, a paragraph):
  // interleaved reasoning opens its own block rather than reopening the old one,
  // which is what keeps the steps in the order they actually happened.
  return [...parts, text ? { kind: "thinking", iteration, text } : { kind: "thinking", iteration }];
}

/**
 * Generation stopped: a call still marked "running" will never settle now, and
 * a permanent spinner reads as "still working". `null` is the honest state —
 * the outcome was never reported.
 */
function closeOpenTools(parts: StreamPart[]): StreamPart[] {
  return parts.map((p) =>
    p.kind === "tool" && p.success === undefined ? { ...p, success: null } : p,
  );
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
  patch(sessionId, (s) => ({ ...s, done: true, parts: closeOpenTools(s.parts) }));
  // Only ever finish the entry being settled: if the operator sends again
  // before this refetch lands, `startChatStream` has already replaced it, and
  // finishing blindly would tear down the NEW stream mid-reply.
  const target = useChatStreamStore.getState().streams[sessionId];
  const finishIfCurrent = () => {
    if (useChatStreamStore.getState().streams[sessionId] === target) finish(sessionId);
  };
  const bail = setTimeout(finishIfCurrent, SETTLE_DEADLINE_MS);
  void queryClient
    .invalidateQueries({ queryKey: chatKeys.messages(sessionId) })
    .finally(() => {
      clearTimeout(bail);
      finishIfCurrent();
    })
    // A rejected invalidation is the query's own problem to report; swallowing
    // it here only stops an unhandled rejection from the `.finally` chain.
    .catch(() => {});
  queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
}

/** Start streaming a reply. No-op if this session already has one in flight. */
export function startChatStream(sessionId: string, text: string) {
  const existing = useChatStreamStore.getState().streams[sessionId];
  if (existing) {
    // Still generating → ignore. A stopped/finished/failed turn whose bubble is
    // only waiting on its refetch is NOT in flight: drop it and send, instead
    // of silently swallowing a message typed right after Stop.
    if (!existing.done) return;
    finish(sessionId);
  }
  useChatStreamStore.setState((st) => ({
    streams: { ...st.streams, [sessionId]: { user: text, parts: [] } },
    // The previous turn's cost must not sit under the new one while it streams.
    turnUsage: drop(st.turnUsage, sessionId) as StreamStore["turnUsage"],
    turnThinking: drop(st.turnThinking, sessionId) as StreamStore["turnThinking"],
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
      () =>
        fail(
          sessionId,
          text,
          "Stream stalled — connection lost",
          `no data for ${STREAM_IDLE_MS / 1000}s`,
        ),
      STREAM_IDLE_MS,
    );
  };
  // Coalesce chunk writes onto a frame. `Markdown` re-parses the WHOLE reply on
  // every render, so writing per token is O(n²) parse work for a long answer —
  // and a paint can only ever show the last write in a frame anyway.
  // Reasoning arrives at token rate too, so it shares the buffer rather than
  // getting its own — one queue is also the only way the two stay interleaved
  // in the order the server sent them.
  type Buffered =
    | { kind: "text"; text: string }
    | { kind: "thinking"; iteration: number; text: string };
  let buffered: Buffered[] = [];
  let frame: number | null = null;
  function bufferPush(b: Buffered) {
    buffered.push(b);
    frame ??= requestAnimationFrame(flushChunks);
  }
  function flushChunks() {
    if (frame != null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    if (buffered.length === 0) return;
    const pending = buffered;
    buffered = [];
    patch(sessionId, (s) => ({
      ...s,
      // One setState for the whole frame; the folds coalesce inside it.
      parts: pending.reduce(
        (parts, b) =>
          b.kind === "text" ? appendText(parts, b.text) : appendThinking(parts, b.iteration, b.text),
        s.parts,
      ),
    }));
  }
  /**
   * Anything that is not text has to land AFTER the text that preceded it, so
   * every non-text part flushes the buffer first — otherwise a tool call
   * queued behind a pending frame jumps in front of the paragraph that
   * introduced it, which is the ordering bug this store was rebuilt to fix.
   */
  function pushPart(part: StreamPart) {
    flushChunks();
    patch(sessionId, (s) => ({ ...s, parts: [...s.parts, part] }));
  }

  controller.signal.addEventListener("abort", () => {
    if (idleTimer) clearTimeout(idleTimer);
    // Flush rather than discard: on Stop the buffered tail is text the reader
    // already watched arrive, and the pending frame must not outlive the stream.
    flushChunks();
  });
  armIdle();

  function fail(id: string, sent: string, message: string, detail?: string) {
    // A late failure from a stream that has already been replaced (its idle
    // timer, a trailing error frame) must not tear down the newer one.
    if (controllers.get(id) !== controller) return;
    // Abort, don't merely clear the timer. Two things ride on it: a server
    // `error` event returns from the read loop leaving the response body
    // unread but OPEN (the lock is released, nothing cancels it), and the abort
    // listener is what cancels the pending frame — a queued flush that outlives
    // the stream would find whatever entry exists when it runs and prepend this
    // dead stream's tail to the NEXT reply in the same session.
    controller.abort();
    toastError(new Error(message));
    controllers.delete(id);
    // The partial answer STAYS on screen with the failure attached to it. It is
    // usually the most useful evidence there is about what went wrong, and
    // deleting the turn to leave only a toast is how a failure becomes
    // impossible to diagnose. `done` frees the composer; the card offers
    // Dismiss.
    patch(id, (s) => ({
      ...s,
      done: true,
      parts: closeOpenTools(s.parts),
      error: { message, detail, at: Date.now() },
    }));
    useChatStreamStore.setState((st) => ({
      failed: { ...st.failed, [id]: sent },
      failedAt: { ...st.failedAt, [id]: Date.now() },
    }));
    // The transcript must be refetched on this path too: the user turn is
    // persisted before inference, and the page unsubscribes from the `chat`
    // channel while streaming — without this, anything written meanwhile
    // (another tab, a channel bridge) stays invisible until an unrelated action.
    void queryClient.invalidateQueries({ queryKey: chatKeys.messages(id) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
  }

  void streamChatMessage(
    sessionId,
    text,
    {
      onActivity: armIdle,
      onChunk: (chunk) => bufferPush({ kind: "text", text: chunk }),
      onThinking: (iteration, text) => {
        // A reasoning delta is token-rate traffic — buffer it like text.
        if (text) return bufferPush({ kind: "thinking", iteration, text });
        // The pass marker is structural, so it patches straight away. Flush
        // FIRST, and outside any updater: zustand computes the updater's result
        // from the state it captured before calling it, so a nested `setState`
        // (which is what `flushChunks` does) is overwritten by the outer return
        // value — and since `flushChunks` has already emptied the buffer, the
        // text is lost for good rather than merely reordered.
        flushChunks();
        patch(sessionId, (s) => ({ ...s, parts: appendThinking(s.parts, iteration, "") }));
      },
      onToolStart: (name, taskId) => pushPart({ kind: "tool", name, taskId }),
      onTool: (name, success, preview, durationMs) => {
        // The result frame arrives after the text that preceded it, and the
        // no-matching-start branch below APPENDS — so the buffer has to be in
        // the list first or an orphan result lands ahead of that text.
        flushChunks();
        patch(sessionId, (s) => {
          // Settle the most recent still-running call for this tool.
          // ponytail: matched by name, newest-open-first. The stream carries no
          // per-call id, so two concurrent calls to the SAME tool in one
          // iteration can swap outcomes/durations. Needs a `call_id` on
          // ToolStart/ToolResult in the kernel to fix properly.
          const parts = [...s.parts];
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            if (p.kind === "tool" && p.name === name && p.success === undefined) {
              parts[i] = { ...p, success, preview, durationMs };
              return { ...s, parts };
            }
          }
          // A result with no start (a reconnect that missed frames): still show it.
          return { ...s, parts: [...parts, { kind: "tool", name, success, preview, durationMs }] };
        });
      },
      onWarning: (message) =>
        patch(sessionId, (s) =>
          s.warnings?.includes(message)
            ? s
            : { ...s, warnings: [...(s.warnings ?? []), message] },
        ),
      onTruncated: () =>
        toast.warning("The reply may be incomplete", {
          id: `chat-truncated-${sessionId}`,
          description:
            "The connection closed before the server finished. Ask it to continue if something is missing.",
        }),
      onDone: (summary?: StreamSummary) => {
        if (idleTimer) clearTimeout(idleTimer);
        // Before the handover, or a frame's worth of trailing tokens is dropped
        // on the floor between the last flush and the bubble going away.
        flushChunks();
        patch(sessionId, (s) => {
          const usage =
            summary &&
            (summary.iterations != null || summary.tokens != null || summary.costUsd != null)
              ? {
                  iterations: summary.iterations,
                  tokens: summary.tokens,
                  costUsd: summary.costUsd,
                }
              : s.usage;
          // Gateway turns (claude-code and friends) run out of band and emit no
          // TextChunk at all — the whole answer arrives once, on `done`. Without
          // this the bubble sits on the typing dots and then blinks to the
          // transcript, so the reply looks like it never streamed.
          const parts = streamText(s).trim()
            ? s.parts
            : summary?.answer?.trim()
              ? appendText(s.parts, summary.answer)
              : s.parts;
          return { ...s, usage, parts };
        });
        const finished = useChatStreamStore.getState().streams[sessionId];
        const thoughts = streamThoughts(finished);
        useChatStreamStore.setState((st) => ({
          ...(finished?.usage ? { turnUsage: { ...st.turnUsage, [sessionId]: finished.usage } } : null),
          ...(thoughts.length ? { turnThinking: { ...st.turnThinking, [sessionId]: thoughts } } : null),
        }));
        settle(sessionId);
      },
      onError: (msg, detail) => fail(sessionId, text, msg, detail),
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
  useChatStreamStore.setState((st) => ({
    turnUsage: drop(st.turnUsage, sessionId) as StreamStore["turnUsage"],
    turnThinking: drop(st.turnThinking, sessionId) as StreamStore["turnThinking"],
  }));
  // Parked retry text for a session that no longer exists would otherwise sit
  // in the store for the life of the tab, and land in the composer of whatever
  // chat is opened next.
  consumeFailedChatText(sessionId);
}

/**
 * The operator read the failure and closed the card. Only ever called on a
 * finished turn, so there is no stream left to abort — just the bubble to clear.
 */
export function dismissChatStream(sessionId: string) {
  finish(sessionId);
  useChatStreamStore.setState((st) => ({
    turnUsage: drop(st.turnUsage, sessionId) as StreamStore["turnUsage"],
    turnThinking: drop(st.turnThinking, sessionId) as StreamStore["turnThinking"],
  }));
}

/** The composer took the parked text back; forget it. */
export function consumeFailedChatText(sessionId: string) {
  useChatStreamStore.setState((st) =>
    sessionId in st.failed
      ? {
          failed: drop(st.failed, sessionId) as Record<string, string>,
          failedAt: drop(st.failedAt, sessionId) as Record<string, number>,
        }
      : st,
  );
}
