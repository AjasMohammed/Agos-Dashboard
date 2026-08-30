import type { FileMeta } from "@/api/models";

/**
 * `artifact-write` tags every row it stores `artifact,kind:<html|markdown|slides>,agent:<id>`.
 * Kept out of the page module so both helpers stay importable from tests without
 * tripping the fast-refresh rule.
 */

/** The `kind:` tag. Anything unrecognised falls back to `markdown`, never `html`. */
export function artifactKind(meta: FileMeta): "html" | "markdown" | "slides" {
  const tag = meta.tags?.find((t) => t.startsWith("kind:"))?.slice(5);
  return tag === "html" || tag === "slides" ? tag : "markdown";
}

/**
 * SECURITY: the `artifact` tag is what separates an agent-published document
 * from an ordinary upload. Only a tagged row may reach the `srcDoc` render
 * path, or any uploaded `.html` would become stored XSS.
 */
export function isArtifact(f: FileMeta): boolean {
  return f.tags?.includes("artifact") ?? false;
}
