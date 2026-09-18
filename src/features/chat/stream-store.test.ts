import { describe, it, expect, beforeEach, vi } from "vitest";
import type { StreamHandlers } from "@/api/queries/chat";

const h = vi.hoisted(() => ({
  handlers: null as StreamHandlers | null,
  /** The `file_ids` the store forwarded for the turn under test. */
  fileIds: undefined as string | undefined,
  /** Every queryKey passed to `invalidateQueries`, in call order. */
  invalidated: [] as (readonly unknown[])[],
  /** One deferred per invalidation, so a test can settle (or reject) the refetch. */
  settlers: [] as { resolve: () => void; reject: (e: unknown) => void }[],
  /** The transcript the refetch would put in the cache. */
  rows: [] as { role: string; content: string; timestamp: string }[],
}));



// Only `streamChatMessage` is faked. The REAL `chatKeys` are used on purpose:
// mocking them hid the bug where the sessions key was a prefix of the messages
// key, so the sessions invalidation cancelled the messages refetch the store
// was awaiting and the reply blinked out for a round trip on every turn.
vi.mock("@/api/queries/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/queries/chat")>()),
  streamChatMessage: (
    _id: string,
    _text: string,
    fileIds: string | undefined,
    handlers: StreamHandlers,
  ) => {
    h.handlers = handlers;
    h.fileIds = fileIds;
    return Promise.resolve();
  },
}));

vi.mock("@/lib/query", () => ({
  queryClient: {
    getQueryData: () => ({ items: h.rows }),
    invalidateQueries: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      h.invalidated = [...h.invalidated, queryKey];
      return new Promise<void>((resolve, reject) => h.settlers.push({ resolve, reject }));
    },
  },
}));
vi.mock("@/lib/errors", () => ({ toastError: () => {} }));

import { chatKeys } from "@/api/queries/chat";
import {
  startChatStream,
  stopChatStream,
  useChatStreamStore,
  abortChatStream,
  dismissChatStream,
  streamText,
  streamTools,
  hydrateTurns,
} from "./stream-store";

beforeEach(() => {
  h.handlers = null;
  h.invalidated = [];
  h.settlers.length = 0;
  h.rows = [];
  localStorage.clear();
  useChatStreamStore.setState({
    streams: {},
    turnUsage: {},
    turns: {},
    failed: {},
    failedAt: {},
  });
});

const stream = (id: string) => useChatStreamStore.getState().streams[id];

describe("chat stream store", () => {
  it("keeps a partial reply after the component that started it is gone", async () => {
    startChatStream("s1", "hi");
    h.handlers?.onChunk("Hel");
    h.handlers?.onChunk("lo");
    // No unmount hook to run — the state is module-scoped, not component-scoped.
    // Chunk writes are coalesced onto a frame, so this lands a tick later.
    await vi.waitFor(() =>
      expect(stream("s1")).toEqual({
        user: "hi",
        parts: [{ kind: "text", text: "Hello" }],
      }),
    );
  });

  it("flushes the coalesced tail before handing over to the transcript", () => {
    startChatStream("s1", "hi");
    h.handlers?.onChunk("Hel");
    h.handlers?.onChunk("lo");
    h.handlers?.onDone();
    // Synchronous: a frame that never got to run must not cost the last tokens.
    expect(streamText(stream("s1"))).toBe("Hello");
  });

  it("clears the entry on done and ignores a duplicate start while in flight", async () => {
    startChatStream("s1", "hi");
    const first = h.handlers;
    startChatStream("s1", "again");
    expect(h.handlers).toBe(first);
    expect(stream("s1").user).toBe("hi");
    first?.onDone();
    expect(h.invalidated[0]).toEqual(chatKeys.messages("s1"));
    expect(h.invalidated[1]).toEqual(chatKeys.sessions);
    // `onDone` holds the live bubble until the refetched transcript lands, so
    // the entry clears a tick later rather than synchronously.
    expect(stream("s1")).toBeDefined();
    h.settlers[0].resolve();
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
  });

  it("lets a send right after Stop replace the settling entry instead of ignoring it", () => {
    startChatStream("s1", "hi");
    const first = h.handlers;
    h.handlers?.onChunk("partial");
    stopChatStream("s1");
    expect(stream("s1").done).toBe(true);
    // The composer is free again: a new turn replaces the settling bubble.
    startChatStream("s1", "follow-up");
    expect(h.handlers).not.toBe(first);
    expect(stream("s1")).toEqual({ user: "follow-up", parts: [] });
    // The first turn's refetch landing later must not tear down the new one.
    h.settlers[0].resolve();
    expect(stream("s1").user).toBe("follow-up");
  });

  it("keeps the streamed reply on Stop until the refetch settles", async () => {
    startChatStream("s1", "hi");
    h.handlers?.onChunk("three paragraphs");
    stopChatStream("s1");
    // The abort flushes the buffer; the bubble must then survive until the
    // transcript is in hand, or a stopped turn the kernel never persisted
    // vanishes from the screen entirely.
    expect(streamText(stream("s1"))).toBe("three paragraphs");
    expect(h.invalidated[0]).toEqual(chatKeys.messages("s1"));
    h.settlers[0].resolve();
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
  });

  it("releases the composer even when the refetch fails", async () => {
    startChatStream("s1", "hi");
    h.handlers?.onDone();
    h.settlers[0].reject(new Error("offline"));
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
  });

  it("settles the newest running call for a tool", () => {
    startChatStream("s1", "hi");
    h.handlers?.onToolStart?.("grep");
    h.handlers?.onToolStart?.("grep");
    h.handlers?.onTool?.("grep", false);
    expect(streamTools(stream("s1"))).toEqual([
      { kind: "tool", name: "grep" },
      { kind: "tool", name: "grep", success: false, preview: undefined, durationMs: undefined },
    ]);
  });

  it("keeps the task id a call runs under through settlement", () => {
    startChatStream("s1", "hi");
    h.handlers?.onToolStart?.("shell-exec", "task-1");
    h.handlers?.onTool?.("shell-exec", true);
    expect(streamTools(stream("s1"))).toEqual([
      {
        kind: "tool",
        name: "shell-exec",
        taskId: "task-1",
        success: true,
        preview: undefined,
        durationMs: undefined,
      },
    ]);
  });

  it("parks the sent text for the composer on error", () => {
    startChatStream("s1", "hi");
    h.handlers?.onError("boom");
    expect(useChatStreamStore.getState().failed.s1).toBe("hi");
  });

  it("keeps the partial reply and the failure on screen instead of deleting the turn", () => {
    startChatStream("s1", "hi");
    h.handlers?.onChunk("half an ans");
    h.handlers?.onToolStart?.("shell-exec");
    h.handlers?.onError("upstream 500", "HTTP 500 · INTERNAL");
    const s = stream("s1");
    // The evidence survives: text, the call that never came back, the message.
    expect(streamText(s)).toBe("half an ans");
    expect(s.error).toMatchObject({ message: "upstream 500", detail: "HTTP 500 · INTERNAL" });
    // A call left running when the stream died is unknown, not "still working".
    expect(streamTools(s)[0].success).toBeNull();
    // …and the composer is free, so the turn can be retried by hand.
    expect(s.done).toBe(true);
    dismissChatStream("s1");
    expect(stream("s1")).toBeUndefined();
  });

  it("records thinking passes and tool calls in arrival order", () => {
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1);
    h.handlers?.onChunk("Let me look.");
    h.handlers?.onToolStart?.("web-search");
    h.handlers?.onTool?.("web-search", true, "3 results", 120);
    h.handlers?.onThinking?.(2);
    h.handlers?.onChunk("Found it.");
    h.handlers?.onDone();
    // Interleaved exactly as the server sent it — tools are NOT hoisted above
    // the text that introduced them.
    expect(stream("s1").parts).toEqual([
      { kind: "thinking", iteration: 1 },
      { kind: "text", text: "Let me look." },
      { kind: "tool", name: "web-search", success: true, preview: "3 results", durationMs: 120 },
      { kind: "thinking", iteration: 2 },
      { kind: "text", text: "Found it." },
    ]);
  });

  it("keeps buffered text when a thinking marker interrupts it", () => {
    // Regression: `flushChunks()` used to run INSIDE the zustand updater, which
    // computes its result from the state captured before the call — so the
    // nested flush was overwritten by the updater's return value, and because
    // the buffer had already been emptied the text was gone for good. A
    // `chunk … thinking … chunk` sequence is the normal shape of a
    // multi-iteration turn, so this silently ate the first half of replies.
    startChatStream("s1", "hi");
    h.handlers?.onChunk("I'll search the docs. ");
    h.handlers?.onThinking?.(2);
    h.handlers?.onChunk("Found it: 42.");
    h.handlers?.onDone();
    expect(stream("s1").parts).toEqual([
      { kind: "text", text: "I'll search the docs. " },
      { kind: "thinking", iteration: 2 },
      { kind: "text", text: "Found it: 42." },
    ]);
  });

  it("keeps buffered text when the turn fails right after a thinking marker", () => {
    // The same bug on the error path erased the whole partial reply — which is
    // the evidence the error card exists to preserve.
    startChatStream("s1", "hi");
    h.handlers?.onChunk("Step 1 done. ");
    h.handlers?.onThinking?.(2);
    h.handlers?.onError("upstream 500", "HTTP 500");
    expect(streamText(stream("s1"))).toBe("Step 1 done. ");
  });

  it("keeps a tool result with no matching start behind the text that preceded it", () => {
    // The orphan branch appends, so the buffer has to be flushed first or the
    // call lands ahead of the text that introduced it.
    startChatStream("s1", "hi");
    h.handlers?.onChunk("Working on it. ");
    h.handlers?.onTool?.("orphan-tool", true, "ok", 5);
    expect(stream("s1").parts.map((p) => p.kind)).toEqual(["text", "tool"]);
  });

  it("streams reasoning text into the pass it belongs to", () => {
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1);
    h.handlers?.onThinking?.(1, "The user wants ");
    h.handlers?.onThinking?.(1, "the disk usage.");
    h.handlers?.onChunk("Checking now.");
    h.handlers?.onDone();
    expect(stream("s1").parts).toEqual([
      { kind: "thinking", iteration: 1, text: "The user wants the disk usage." },
      { kind: "text", text: "Checking now." },
    ]);
    // Reasoning is the scratchpad, not the reply — it must never reach the
    // answer text that gets copied, exported, or compared against the transcript.
    expect(streamText(stream("s1"))).toBe("Checking now.");
  });

  it("opens a second thinking block when reasoning resumes after a tool call", () => {
    // Interleaved thinking: the same pass reasons again after a call comes back.
    // Folding that into the first block would claim it happened before the call.
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1, "check the disk");
    h.handlers?.onToolStart?.("shell-exec");
    h.handlers?.onTool?.("shell-exec", true, "87% used", 20);
    h.handlers?.onThinking?.(1, "that is nearly full");
    h.handlers?.onDone();
    expect(stream("s1").parts).toEqual([
      { kind: "thinking", iteration: 1, text: "check the disk" },
      { kind: "tool", name: "shell-exec", success: true, preview: "87% used", durationMs: 20 },
      { kind: "thinking", iteration: 1, text: "that is nearly full" },
    ]);
  });

  it("keeps reasoning and answer text in the order they arrived", () => {
    // Both ride the same rAF buffer; two buffers would let a frame's worth of
    // one overtake the other.
    startChatStream("s1", "hi");
    h.handlers?.onChunk("First. ");
    h.handlers?.onThinking?.(2, "now reconsider");
    h.handlers?.onChunk("Second.");
    h.handlers?.onDone();
    expect(stream("s1").parts).toEqual([
      { kind: "text", text: "First. " },
      { kind: "thinking", iteration: 2, text: "now reconsider" },
      { kind: "text", text: "Second." },
    ]);
  });

  /** The refetch lands: the kernel's persisted rows, newest reply last. */
  function transcript(...replies: string[]) {
    h.rows = replies.flatMap((content, i) => [
      { role: "user", content: `q${i}`, timestamp: `2026-09-10T10:0${i}:00Z` },
      { role: "assistant", content, timestamp: `2026-09-10T10:0${i}:30Z` },
    ]);
  }

  it("files the turn's parts under the row the transcript brought back", async () => {
    // `ApiChatMessage` has no field for reasoning, so without this the thinking
    // blocks vanish the instant the refetch lands — which is exactly when the
    // reader goes back to check the model's working.
    transcript("first reply");
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1, "check the disk first");
    h.handlers?.onChunk("87% used.");
    h.handlers?.onThinking?.(2);
    h.handlers?.onDone();
    transcript("first reply", "87% used.");
    h.settlers.forEach((s) => s.resolve());
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
    // The bare pass-2 marker is dropped: it only ever meant "a pass started".
    expect(useChatStreamStore.getState().turns.s1).toEqual({
      "2026-09-10T10:01:30Z": [
        { kind: "thinking", iteration: 1, text: "check the disk first" },
        { kind: "text", text: "87% used." },
        { kind: "thinking", iteration: 2 },
      ],
    });
  });

  it("keeps an older turn's parts when the next turn starts", async () => {
    // The bug this whole log exists for: one slot per session meant turn 1's
    // reasoning was gone the moment turn 2 was sent.
    transcript("first reply");
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1, "first turn thoughts");
    h.handlers?.onDone();
    transcript("first reply", "second reply");
    h.settlers.forEach((s) => s.resolve());
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
    startChatStream("s1", "again");
    expect(useChatStreamStore.getState().turns.s1).toEqual({
      "2026-09-10T10:01:30Z": [{ kind: "thinking", iteration: 1, text: "first turn thoughts" }],
    });
  });

  it("survives a reload (hydrated back out of storage)", async () => {
    transcript("first reply");
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1, "still here");
    h.handlers?.onDone();
    transcript("first reply", "the reply");
    h.settlers.forEach((s) => s.resolve());
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
    useChatStreamStore.setState({ turns: {} }); // a fresh tab
    hydrateTurns("s1");
    expect(useChatStreamStore.getState().turns.s1).toEqual({
      "2026-09-10T10:01:30Z": [{ kind: "thinking", iteration: 1, text: "still here" }],
    });
  });

  it("drops the turn rather than staple it to the previous reply", async () => {
    // The handover refetch failed, so the cache still ends at the PREVIOUS
    // assistant row. Writing there would misattribute it, permanently.
    transcript("first reply");
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1, "would be misfiled");
    h.handlers?.onDone();
    // Only the messages refetch fails; the sessions one is a separate promise
    // the store deliberately doesn't await (rejecting it here would just be an
    // unhandled rejection in the test, not a code path).
    h.settlers[0].reject(new Error("refetch failed"));
    h.settlers.slice(1).forEach((s) => s.resolve());
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
    expect(useChatStreamStore.getState().turns.s1).toBeUndefined();
  });

  it("keeps the parts of a turn the operator stopped", async () => {
    transcript("first reply");
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1, "half a thought");
    stopChatStream("s1");
    transcript("first reply", "partial");
    h.settlers.forEach((s) => s.resolve());
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
    expect(useChatStreamStore.getState().turns.s1).toEqual({
      "2026-09-10T10:01:30Z": [{ kind: "thinking", iteration: 1, text: "half a thought" }],
    });
  });

  it("stores nothing for a plain text turn", async () => {
    transcript("first reply");
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1);
    h.handlers?.onChunk("done");
    h.handlers?.onDone();
    transcript("first reply", "done");
    h.settlers.forEach((s) => s.resolve());
    await vi.waitFor(() => expect(stream("s1")).toBeUndefined());
    expect(useChatStreamStore.getState().turns.s1).toBeUndefined();
  });

  it("does not repeat a thinking marker for the same pass", () => {
    startChatStream("s1", "hi");
    h.handlers?.onThinking?.(1);
    h.handlers?.onThinking?.(1);
    expect(stream("s1").parts).toEqual([{ kind: "thinking", iteration: 1 }]);
  });

  it("falls back to the done frame's answer when no chunks arrived", () => {
    // Gateway turns run out of band: the whole reply lands once, on `done`.
    startChatStream("s1", "hi");
    h.handlers?.onDone({ answer: "the whole reply", iterations: 2, tokens: 900, costUsd: 0.01 });
    expect(streamText(stream("s1"))).toBe("the whole reply");
    expect(stream("s1").usage).toEqual({ iterations: 2, tokens: 900, costUsd: 0.01 });
  });

  it("collects protocol warnings without killing the stream", () => {
    startChatStream("s1", "hi");
    h.handlers?.onWarning?.("Unknown stream event \"audio\"");
    h.handlers?.onWarning?.("Unknown stream event \"audio\"");
    h.handlers?.onChunk("still fine");
    expect(stream("s1").warnings).toEqual(['Unknown stream event "audio"']);
  });

  it("marks a call still running when the operator stops the turn as unknown", () => {
    startChatStream("s1", "hi");
    h.handlers?.onToolStart?.("shell-exec");
    stopChatStream("s1");
    expect(streamTools(stream("s1"))[0].success).toBeNull();
  });

  it("drops everything on abort, with nothing left to restore", () => {
    startChatStream("s1", "hi");
    h.handlers?.onError("boom");
    expect(stream("s1")).toBeDefined();
    // The session is gone, so its parked retry text must go too — otherwise it
    // sits in the store for the life of the tab and lands in the next chat's
    // composer.
    abortChatStream("s1");
    expect(stream("s1")).toBeUndefined();
    expect(useChatStreamStore.getState().failed.s1).toBeUndefined();
  });
});
