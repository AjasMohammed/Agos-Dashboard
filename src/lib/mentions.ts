import type { FileMeta } from "@/api/models";

/** The `@token` being typed at the caret, if any. Mirrors the backend mention
 *  pattern `@[\w.-]+` (file_store @mention matching). */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const upTo = text.slice(0, caret);
  const m = /(?:^|\s)@([\w.-]*)$/.exec(upTo);
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1] };
}

/** Uploaded files matching the typed query — prefix matches first, capped. */
export function matchFiles(files: FileMeta[], query: string, limit = 8): FileMeta[] {
  const q = query.toLowerCase();
  return files
    .filter((f) => f.name.toLowerCase().includes(q) || f.original_name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
