import type { Provider } from "@/api/models";

/**
 * What the dialog may offer for a provider's key, mirroring how the kernel
 * resolves one: `<agent>_<provider>_api_key`, then the shared
 * `<provider>_api_key`, then (catalog providers only) the env var.
 * Getting `sharedKeyName` wrong stores a key under a name the kernel never
 * reads, which only shows up later as a 401 from the provider.
 */
export function keyOptions(entry: Provider | undefined, provider: string, saved: string[]) {
  return {
    // Empty `api_key_env` means the provider authenticates some other way
    // (ollama, claude-code); an unlisted provider ("custom") may or may not.
    needsKey: !entry || entry.api_key_env !== "",
    sharedKeyName: `${provider}_api_key`,
    hasSaved: saved.includes(`${provider}_api_key`),
    // The built-in adapters read the vault alone, so their `api_key_set` (which
    // reflects the env var) must not be offered as a usable key here.
    envKey: entry?.source === "catalog" && entry.api_key_set ? (entry.api_key_env ?? "") : "",
  };
}
