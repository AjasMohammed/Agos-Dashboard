import { describe, expect, it } from "vitest";
import { auditRowKeys, cleanEventType } from "./audit-rows";

describe("cleanEventType", () => {
  it("renders quoted and unquoted event types the same way", () => {
    expect(cleanEventType('"TaskCompleted"')).toBe("TaskCompleted");
    expect(cleanEventType("TaskCompleted")).toBe("TaskCompleted");
    expect(cleanEventType(' "ToolExecuted" ')).toBe("ToolExecuted");
  });
});

describe("auditRowKeys", () => {
  it("numbers identical entries so keys stay unique", () => {
    const e = { timestamp: "t", event_type: "X", details: "{}", agent_id: null };
    expect(auditRowKeys([e, e, { ...e, agent_id: "a" }])).toEqual(["t|X||{}", "t|X||{}#2", "t|X|a|{}"]);
  });
});
