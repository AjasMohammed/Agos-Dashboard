import { CONFIG_HINTS, CONFIG_SECTION_HINTS } from "./config-hints.gen";

/**
 * One-line description of a config key, from the kernel's annotated
 * default.toml. Keys the file leaves uncommented fall back to the doc of the
 * nearest documented table ("kernel.autonomous_mode" for
 * "kernel.autonomous_mode.max_iterations").
 */
export function configHint(key: string): string | undefined {
  const own = configKeyHint(key);
  if (own) return own;
  const parts = key.split(".");
  for (let n = parts.length - 1; n > 0; n--) {
    const table = CONFIG_SECTION_HINTS[parts.slice(0, n).join(".")];
    if (table) return table;
  }
  return undefined;
}

/** The key's own doc, with no table fallback — for rows, where a table doc would
 * repeat identically on every sibling key. */
export function configKeyHint(key: string): string | undefined {
  return CONFIG_HINTS[key];
}

/** Doc for a config table ("kernel", "gateway"), shown once on its card. */
export function configSectionHint(section: string): string | undefined {
  return CONFIG_SECTION_HINTS[section];
}
