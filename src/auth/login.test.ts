import { describe, expect, it } from "vitest";
import { safeRedirect } from "./login";

describe("safeRedirect", () => {
  it("keeps a local path", () => {
    expect(safeRedirect("/tasks")).toBe("/tasks");
    expect(safeRedirect("/agents/researcher")).toBe("/agents/researcher");
  });

  it("rejects anything that could leave the origin", () => {
    // Protocol-relative URLs: the browser reads "//evil.com" as https://evil.com.
    expect(safeRedirect("//evil.com")).toBe("/");
    expect(safeRedirect("/\\evil.com")).toBe("/");
    expect(safeRedirect("https://evil.com")).toBe("/");
    expect(safeRedirect("javascript:alert(1)")).toBe("/");
    // Control characters are stripped by the browser before it parses the URL,
    // so this one is protocol-relative by the time it matters.
    expect(safeRedirect("/\t/evil.com")).toBe("/");
    expect(safeRedirect("/\n\r/evil.com")).toBe("/");
  });

  it("falls back to home when there is nothing to resume", () => {
    expect(safeRedirect("")).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
  });
});
