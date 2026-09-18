import { describe, it, expect, beforeEach } from "vitest";
import { clearTurnLog, readTurnLog, saveTurn } from "./turn-log";
import type { StreamPart } from "./stream-store";

const turn = (text: string): StreamPart[] => [
  { kind: "thinking", iteration: 1, text },
  { kind: "tool", name: "shell", success: true },
  { kind: "text", text: "done" },
];

describe("turn log", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a turn against its row, across reads", () => {
    saveTurn("s1", "2026-09-10T10:00:00Z", turn("first"));
    saveTurn("s1", "2026-09-10T10:01:00Z", turn("second"));
    // A later turn must not evict the earlier one — that was the bug.
    expect(readTurnLog("s1")["2026-09-10T10:00:00Z"]).toEqual(turn("first"));
    expect(readTurnLog("s2")).toEqual({});
    clearTurnLog("s1");
    expect(readTurnLog("s1")).toEqual({});
  });

  it("ignores a corrupt stored value instead of handing it to the render", () => {
    // A truncated write / an older shape / an extension. The transcript maps
    // over whatever comes back, so a bad value here would throw inside the
    // render and take the conversation down through the error boundary — on
    // every reload, with nothing in the UI able to clear the key.
    localStorage.setItem(
      "agentos-panel:chat-turn:s1",
      JSON.stringify({
        a: "oops",
        b: [{ kind: "text" }],
        c: [{ kind: "sorcery" }],
        d: [{ kind: "text", text: "ok" }],
      }),
    );
    expect(readTurnLog("s1")).toEqual({ d: [{ kind: "text", text: "ok" }] });
    localStorage.setItem("agentos-panel:chat-turn:s2", "{not json");
    expect(readTurnLog("s2")).toEqual({});
  });

  it("drops the oldest turns past the cap", () => {
    for (let i = 0; i < 60; i++) {
      saveTurn("s1", `2026-09-10T10:${String(i).padStart(2, "0")}:00Z`, turn(`t${i}`));
    }
    const log = readTurnLog("s1");
    expect(Object.keys(log)).toHaveLength(50);
    expect(log["2026-09-10T10:00:00Z"]).toBeUndefined();
    expect(log["2026-09-10T10:59:00Z"]).toBeDefined();
  });
});
