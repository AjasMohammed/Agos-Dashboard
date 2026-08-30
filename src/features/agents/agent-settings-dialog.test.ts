import { describe, expect, it } from "vitest";
import { changedSettings, isNoOp, type AgentSettingsValues } from "./agent-settings-dialog";

const loaded: AgentSettingsValues = {
  description: "does the thing",
  thinking_level: "high",
  system_prompt: "You are a careful assistant.",
};

describe("changedSettings", () => {
  it("sends nothing but the name when nothing changed", () => {
    const body = changedSettings("scout", loaded, { ...loaded });
    expect(body).toEqual({ agent_name: "scout" });
    expect(isNoOp(body)).toBe(true);
  });

  it("sends only the field that changed", () => {
    const body = changedSettings("scout", loaded, { ...loaded, description: "does it better" });
    // The regression this guards: a description edit used to also ship
    // `thinking_level` and an empty `system_prompt`, wiping both.
    expect(body).toEqual({ agent_name: "scout", description: "does it better" });
    expect(isNoOp(body)).toBe(false);
  });

  it("clears a set system prompt with an explicit empty string", () => {
    const body = changedSettings("scout", loaded, { ...loaded, system_prompt: "" });
    expect(body).toEqual({ agent_name: "scout", system_prompt: "" });
  });

  it("omits a system prompt that was empty on load and stayed empty", () => {
    const blank = { ...loaded, system_prompt: "" };
    const body = changedSettings("scout", blank, { ...blank, thinking_level: "off" });
    expect(body).toEqual({ agent_name: "scout", thinking_level: "off" });
    expect("system_prompt" in body).toBe(false);
  });

  it("compares the trimmed description so whitespace alone is not a change", () => {
    const body = changedSettings("scout", loaded, { ...loaded, description: "  does the thing  " });
    expect(isNoOp(body)).toBe(true);
  });
});
