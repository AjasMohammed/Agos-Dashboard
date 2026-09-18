import { stripUserDataTags } from "./format";

/**
 * A tool call's input/output as the trace stores it is rarely readable:
 * outputs are usually a *string* holding `<user_data>`-framed JSON, and MCP
 * tools nest their real (markdown) text under `content[].text`. Shown raw that
 * is one line of escaped `\"` and `\n`. This peels those layers so the UI can
 * render prose as prose and objects as key/value rows.
 */
export type ReadablePayload =
  | { kind: "empty" }
  | { kind: "text"; text: string; markdown: boolean }
  | { kind: "value"; value: unknown };

/** Parsing a multi-MB string just to truncate it is wasted main-thread time. */
const MAX_PARSE_CHARS = 1_000_000;

/** Keys that are tool hints for the model, not data for a person. */
const NOISE_KEYS = new Set(["_meta"]);

export function readablePayload(v: unknown, depth = 0): ReadablePayload {
  if (v == null || v === "") return { kind: "empty" };

  if (typeof v === "string") {
    const s = stripUserDataTags(v);
    if (!s) return { kind: "empty" };
    const c = s[0];
    if ((c === "{" || c === "[" || c === '"') && s.length <= MAX_PARSE_CHARS && depth < 3) {
      try {
        return readablePayload(JSON.parse(s), depth + 1);
      } catch {
        /* not JSON — plain text */
      }
    }
    return { kind: "text", text: s, markdown: false };
  }

  if (typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    // MCP tool result: { content: [{ type: "text", text }], isError? }
    if (Array.isArray(obj.content) && obj.content.length > 0) {
      const texts = obj.content
        .filter((p): p is { type: string; text: string } =>
          p != null && typeof p === "object" && (p as { type?: unknown }).type === "text" &&
          typeof (p as { text?: unknown }).text === "string",
        )
        .map((p) => p.text);
      if (texts.length === obj.content.length) {
        return { kind: "text", text: stripUserDataTags(texts.join("\n\n")), markdown: true };
      }
    }
    const keys = Object.keys(obj).filter((k) => !NOISE_KEYS.has(k));
    if (keys.length === 0) return { kind: "empty" };
    if (keys.length !== Object.keys(obj).length) {
      return { kind: "value", value: Object.fromEntries(keys.map((k) => [k, obj[k]])) };
    }
  }

  return { kind: "value", value: v };
}
