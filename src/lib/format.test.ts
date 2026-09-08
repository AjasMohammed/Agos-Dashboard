import { describe, it, expect } from "vitest";
import { bytes, tokens, usd, relativeTime, stripUserDataTags, prettyJson, flattenConfig, configValue } from "./format";

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

  it("strips mirrored <user_data> framing from agent text", () => {
    expect(stripUserDataTags("<user_data>hi</user_data>")).toBe("hi");
    expect(stripUserDataTags("a <USER_DATA>b</User_Data> c")).toBe("a b c");
    expect(stripUserDataTags("  plain\n")).toBe("plain");
  });

  it("renders relative time for invalid/empty input safely", () => {
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime("not-a-date")).toBe("—");
  });

  it("pretty-prints JSON and caps oversized payloads", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("not json")).toBe("not json");
    expect(prettyJson(null)).toBeNull();

    // A blob past the cap is truncated, not laid out in full.
    const huge = JSON.stringify({ blob: "x".repeat(50_000) });
    const out = prettyJson(huge)!;
    expect(out.length).toBeLessThan(21_000);
    expect(out).toContain("more characters truncated");
  });

  it("flattens a config tree to dotted keys", () => {
    const leaves = flattenConfig({
      api: { port: 8080, cors: ["a", "b"] },
      hal: { raw_usb: { allow: [] } },
      approval: { agent_overrides: {} },
      nothing: null,
    });
    expect(leaves).toEqual([
      { key: "api.port", value: 8080 },
      { key: "api.cors", value: ["a", "b"] },
      { key: "hal.raw_usb.allow", value: [] },
      { key: "approval.agent_overrides", value: {} },
      { key: "nothing", value: null },
    ]);
  });

  it("displays config values compactly, rounding f32 noise", () => {
    expect(configValue(0.30000001192092896)).toBe("0.3");
    expect(configValue(8080)).toBe("8080");
    expect(configValue(true)).toBe("true");
    expect(configValue("locked")).toBe("locked");
    expect(configValue(["a", "b"])).toBe('["a","b"]');
    expect(configValue(null)).toBe("—");
  });
});
