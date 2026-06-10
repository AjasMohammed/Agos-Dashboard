import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ClientFrame, ServerFrame } from "./protocol";

// Capture the transport interactions without a real socket.
const h = vi.hoisted(() => ({
  sent: [] as ClientFrame[],
  frame: null as ((f: ServerFrame) => void) | null,
  reconnect: null as (() => void) | null,
}));

vi.mock("./connection", () => ({
  sendFrame: (f: ClientFrame) => h.sent.push(f),
  addFrameListener: (fn: (f: ServerFrame) => void) => {
    h.frame = fn;
    return () => {};
  },
  onReconnect: (fn: () => void) => {
    h.reconnect = fn;
    return () => {};
  },
}));

import { subscribe, __test } from "./subscriptions";

beforeEach(() => {
  h.sent.length = 0;
  h.frame = null;
  h.reconnect = null;
  __test.reset();
});

describe("subscription manager (ref-counted)", () => {
  it("sends one subscribe for two subscribers and unsubscribe only on the last", () => {
    const off1 = subscribe("tasks", () => {});
    const off2 = subscribe("tasks", () => {});
    expect(h.sent.filter((f) => f.type === "subscribe")).toHaveLength(1);
    expect(__test.handlerCount("tasks")).toBe(2);

    // Server confirms the subscription id (needed to unsubscribe).
    h.frame?.({ type: "subscribed", channel: "tasks", subscription_id: "sub-1" });

    off1();
    expect(__test.activeChannels()).toContain("tasks");
    expect(h.sent.some((f) => f.type === "unsubscribe")).toBe(false);

    off2();
    expect(__test.activeChannels()).not.toContain("tasks");
    expect(h.sent).toContainEqual({ type: "unsubscribe", subscription_id: "sub-1" });
  });

  it("dispatches events to handlers including parameterized children", () => {
    const calls: string[] = [];
    subscribe("tasks", (e) => calls.push(e.channel));
    h.frame?.({ type: "event", channel: "tasks", event: "task.updated", data: {} });
    h.frame?.({ type: "event", channel: "tasks:abc", event: "task.updated", data: {} });
    h.frame?.({ type: "event", channel: "agents", event: "agent.online", data: {} });
    expect(calls).toEqual(["tasks", "tasks:abc"]);
  });

  it("re-sends subscribe frames for active channels on reconnect", () => {
    subscribe("tasks", () => {});
    subscribe("audit", () => {});
    h.sent.length = 0;
    h.reconnect?.();
    const channels = h.sent.filter((f) => f.type === "subscribe").map((f) => (f as { channel: string }).channel);
    expect(channels.sort()).toEqual(["audit", "tasks"]);
  });
});
