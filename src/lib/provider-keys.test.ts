import { describe, expect, it } from "vitest";
import { keyOptions } from "./provider-keys";
import type { Provider } from "@/api/models";

const provider = (over: Partial<Provider>): Provider => ({
  name: "x",
  display_name: "X",
  source: "built-in",
  api_key_env: "",
  api_key_set: false,
  ...over,
});

describe("keyOptions", () => {
  it("hides the key field for providers that authenticate some other way", () => {
    const o = keyOptions(provider({ name: "ollama" }), "ollama", []);
    expect(o.needsKey).toBe(false);
  });

  it("names the shared secret the way the kernel resolves it", () => {
    // Built-in, catalog and unlisted providers all use `<provider>_api_key`.
    expect(keyOptions(undefined, "anthropic", []).sharedKeyName).toBe("anthropic_api_key");
    expect(keyOptions(undefined, "groq", []).sharedKeyName).toBe("groq_api_key");
    expect(keyOptions(undefined, "custom", []).sharedKeyName).toBe("custom_api_key");
  });

  it("offers a stored key only when that exact secret exists", () => {
    const p = provider({ name: "anthropic", api_key_env: "ANTHROPIC_API_KEY" });
    expect(keyOptions(p, "anthropic", ["openai_api_key"]).hasSaved).toBe(false);
    // A per-agent key belongs to that agent, not to the one being added.
    expect(keyOptions(p, "anthropic", ["bob_anthropic_api_key"]).hasSaved).toBe(false);
    expect(keyOptions(p, "anthropic", ["anthropic_api_key"]).hasSaved).toBe(true);
  });

  it("offers the env var for catalog providers only", () => {
    const env = { api_key_env: "GROQ_API_KEY", api_key_set: true };
    expect(keyOptions(provider({ ...env, source: "catalog" }), "groq", []).envKey).toBe("GROQ_API_KEY");
    // Built-in adapters never read the env var — offering it would strand the user.
    expect(keyOptions(provider({ ...env, source: "built-in" }), "openai", []).envKey).toBe("");
  });
});
