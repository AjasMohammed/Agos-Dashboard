import { describe, it, expect, beforeEach, vi } from "vitest";
import type { StreamHandlers } from "@/api/queries/chat";

const h = vi.hoisted(() => ({
  handlers: null as StreamHandlers | null,
  /** Every queryKey passed to `invalidateQueries`, in call order. */
  invalidated: [] as (readonly unknown[])[],
  /** One deferred per invalidation, so a test can settle (or reject) the refetch. */
  settlers: [] as { resolve: () => void; reject: (e: unknown) => void }[],
}));

// Only `streamChatMessage` is faked. The REAL `chatKeys` are used on purpose:
// mocking them hid the bug where the sessions key was a prefix of the messages
// key, so the sessions invalidation cancelled the messages refetch the store
// was awaiting and the reply blinked out for a round trip on every turn.
vi.mock("@/api/queries/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/queries/chat")>()),
  streamChatMessage: (_id: string, _text: string, handlers: StreamHandlers) => {
    h.handlers = handlers;
    return Promise.resolve();
  },
}));

vi.mock("@/lib/query", () => ({
  queryClient: {
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
} from "./stream-store";

beforeEach(() => {
  h.handlers = null;
  h.invalidated = [];
  h.settlers.length = 0;
  useChatStreamStore.setState({ streams: {}, failed: {} });
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
      expect(stream("s1")).toEqual({ user: "hi", assistant: "Hello", tools: [] }),
    );
  });

  it("flushes the coalesced tail before handing over to the transcript", () => {
    startChatStream("s1", "hi");
    h.handlers?.onChunk("Hel");
    h.handlers?.onChunk("lo");
    h.handlers?.onDone();
    // Synchronous: a frame that never got to run must not cost the last tokens.
    expect(stream("s1").assistant).toBe("Hello");
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

  it("keeps the streamed reply on Stop until the refetch settles", async () => {
    startChatStream("s1", "hi");
    h.handlers?.onChunk("three paragraphs");
    stopChatStream("s1");
    // The abort flushes the buffer; the bubble must then survive until the
    // transcript is in hand, or a stopped turn the kernel never persisted
    // vanishes from the screen entirely.
    expect(stream("s1").assistant).toBe("three paragraphs");
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
    expect(stream("s1").tools).toEqual([{ name: "grep" }, { name: "grep", success: false }]);
  });

  it("keeps the task id a call runs under through settlement", () => {
    startChatStream("s1", "hi");
    h.handlers?.onToolStart?.("shell-exec", "task-1");
    h.handlers?.onTool?.("shell-exec", true);
    expect(stream("s1").tools).toEqual([{ name: "shell-exec", taskId: "task-1", success: true }]);
  });

  it("parks the sent text for the composer on error", () => {
    startChatStream("s1", "hi");
    h.handlers?.onError("boom");
    expect(stream("s1")).toBeUndefined();
    expect(useChatStreamStore.getState().failed.s1).toBe("hi");
  });

  it("drops everything on abort, with nothing left to restore", () => {
    startChatStream("s1", "hi");
    h.handlers?.onError("boom");
    // The session is gone, so its parked retry text must go too — otherwise it
    // sits in the store for the life of the tab and lands in the next chat's
    // composer.
    abortChatStream("s1");
    expect(stream("s1")).toBeUndefined();
    expect(useChatStreamStore.getState().failed.s1).toBeUndefined();
  });
});
