import { describe, it, expect } from "vitest";
import { configHint } from "./config-hints";

describe("configHint", () => {
  it("returns the key's own doc when the kernel documents it", () => {
    expect(configHint("api.config_writable")).toMatch(/Allow PUT/);
  });

  it("falls back to the nearest documented table", () => {
    // Undocumented leaf under a documented table.
    expect(configHint("kernel.autonomous_mode.max_iterations")).toMatch(/autonomous=true/);
  });

  it("returns undefined for keys nothing documents", () => {
    expect(configHint("llm.primary")).toBeUndefined();
    expect(configHint("nope")).toBeUndefined();
  });
});
