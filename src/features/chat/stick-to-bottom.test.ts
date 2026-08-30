import { describe, expect, it } from "vitest";
import { isPinned, PIN_THRESHOLD } from "./stick-to-bottom";

describe("isPinned", () => {
  it("is pinned at the exact bottom", () => {
    expect(isPinned({ scrollTop: 400, scrollHeight: 900, clientHeight: 500 })).toBe(true);
  });

  it("stays pinned within the threshold", () => {
    expect(
      isPinned({ scrollTop: 400 - PIN_THRESHOLD, scrollHeight: 900, clientHeight: 500 }),
    ).toBe(true);
  });

  it("unpins once scrolled past the threshold", () => {
    expect(
      isPinned({ scrollTop: 400 - PIN_THRESHOLD - 1, scrollHeight: 900, clientHeight: 500 }),
    ).toBe(false);
  });

  it("is pinned when the content does not overflow", () => {
    expect(isPinned({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })).toBe(true);
  });
});
