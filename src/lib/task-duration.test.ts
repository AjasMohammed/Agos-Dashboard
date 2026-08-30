import { describe, it, expect } from "vitest";
import { durationBetween, formatDuration } from "./task-duration";

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(400)).toBe("1 s");
    expect(formatDuration(12_000)).toBe("12 s");
    expect(formatDuration(184_000)).toBe("3 min 4 s");
    expect(formatDuration(180_000)).toBe("3 min");
    expect(formatDuration(7_500_000)).toBe("2 h 5 min");
    expect(formatDuration(-1)).toBe("—");
  });

  it("derives a duration from two timestamps", () => {
    expect(durationBetween("2026-01-01T00:00:00Z", "2026-01-01T00:00:12Z")).toBe("12 s");
    expect(durationBetween("2026-01-01T00:00:00Z", null)).toBeNull();
    expect(durationBetween("nope", "2026-01-01T00:00:12Z")).toBeNull();
  });
});
