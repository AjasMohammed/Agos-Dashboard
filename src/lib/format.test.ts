import { describe, it, expect } from "vitest";
import { bytes, tokens, usd, relativeTime } from "./format";

describe("formatters", () => {
  it("formats bytes", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1024)).toBe("1.0 KiB");
    expect(bytes(1024 * 1024 * 1.5)).toBe("1.5 MiB");
    expect(bytes(null)).toBe("—");
  });

  it("formats token counts", () => {
    expect(tokens(950)).toBe("950");
    expect(tokens(12_300)).toBe("12.3k");
    expect(tokens(2_500_000)).toBe("2.50M");
  });

  it("formats usd with adaptive precision", () => {
    expect(usd(1.5)).toBe("$1.50");
    expect(usd(0.0034)).toBe("$0.0034");
    expect(usd(null)).toBe("—");
  });

  it("renders relative time for invalid/empty input safely", () => {
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime("not-a-date")).toBe("—");
  });
});
