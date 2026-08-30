import { describe, expect, it } from "vitest";
import { toolVerb } from "./tool-verbs";

describe("toolVerb", () => {
  it("names known tools in plain language", () => {
    expect(toolVerb("web-search")).toBe("Searched the web");
    expect(toolVerb("schedule-recurring")).toBe("Set up a schedule");
    expect(toolVerb("memory-store")).toBe("Checked memory");
  });

  it("prefers an exact match over a prefix", () => {
    expect(toolVerb("file-reader")).toBe("Read a file");
    expect(toolVerb("file-glob")).toBe("Worked with a file");
  });

  it("falls back to the raw name so nothing is hidden", () => {
    expect(toolVerb("weird-tool")).toBe("weird-tool");
  });
});
