import { describe, expect, it } from "vitest";
import { taskTitle } from "./task-title";

describe("taskTitle", () => {
  it("skips bracketed context headers and 'You are' boilerplate", () => {
    const p = "[SYSTEM CONTEXT]\nYou are nimo operating inside AgentOS.\n\n[EVENT NOTIFICATION]\nAn agent has been removed from this AgentOS instance.\n";
    expect(taskTitle(p)).toBe("An agent has been removed from this AgentOS instance.");
  });
  it("returns plain prompts unchanged", () => {
    expect(taskTitle("Execute the 'Market Intelligence' procedure")).toBe("Execute the 'Market Intelligence' procedure");
  });
  it("truncates long titles", () => {
    expect(taskTitle("x".repeat(200), 20)).toHaveLength(20);
  });
  it("treats a preview-truncated header as noise", () => {
    expect(taskTitle("[SYSTEM CONTEXT]\nYou are nimo operating inside AgentOS.\n\n[EVENT NOTIFICATIO")).toBe("[SYSTEM CONTEXT]");
  });
  it("keeps a content line that merely starts with a bracket", () => {
    expect(taskTitle("[urgent] fix the build")).toBe("[urgent] fix the build");
  });
  it("handles empty input", () => {
    expect(taskTitle(undefined)).toBe("");
  });
});
