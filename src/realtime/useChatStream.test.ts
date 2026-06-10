import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ClientFrame, ServerFrame } from "./protocol";

const h = vi.hoisted(() => ({
  listener: null as ((f: ServerFrame) => void) | null,
  sent: [] as ClientFrame[],
}));

vi.mock("./connection", () => ({
  addFrameListener: (fn: (f: ServerFrame) => void) => {
    h.listener = fn;
    return () => {};
  },
  sendFrame: (f: ClientFrame) => h.sent.push(f),
}));

import { useChatStream } from "./useChatStream";

beforeEach(() => {
  h.listener = null;
  h.sent.length = 0;
});

describe("useChatStream", () => {
  it("sends chat.send, accumulates deltas in order, and resolves on done", () => {
    const { result } = renderHook(() => useChatStream("sess-1"));

    act(() => result.current.send("hi", "alpha"));
    expect(h.sent).toContainEqual({
      type: "chat.send",
      session_id: "sess-1",
      message: "hi",
      agent_name: "alpha",
    });
    expect(result.current.streaming).toBe(true);

    act(() => h.listener?.({ type: "chat.chunk", session_id: "sess-1", delta: "Hel" }));
    act(() => h.listener?.({ type: "chat.chunk", session_id: "sess-1", delta: "lo" }));
    expect(result.current.text).toBe("Hello");

    // A delta for a different session must be ignored.
    act(() => h.listener?.({ type: "chat.chunk", session_id: "other", delta: "X" }));
    expect(result.current.text).toBe("Hello");

    act(() => h.listener?.({ type: "chat.done", session_id: "sess-1", tool_calls: [] }));
    expect(result.current.streaming).toBe(false);
  });

  it("cancel sends a chat.cancel frame", () => {
    const { result } = renderHook(() => useChatStream("sess-2"));
    act(() => result.current.cancel());
    expect(h.sent).toContainEqual({ type: "chat.cancel", session_id: "sess-2" });
  });
});
