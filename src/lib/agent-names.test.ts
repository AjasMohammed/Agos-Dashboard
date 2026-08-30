import { describe, expect, it } from "vitest";
import { agentLabel } from "./agent-names";

describe("agentLabel", () => {
  it("prefers the resolved name", () => {
    expect(agentLabel("Sandae", "3b6f…")).toBe("Sandae");
  });
  it("falls back to a shortened id", () => {
    expect(agentLabel(null, "3b6f2a9c-1111-2222-3333-444444444444")).toBe("3b6f2a9c…");
  });
  it("handles a missing id", () => {
    expect(agentLabel(null, null)).toBe("—");
  });
});
