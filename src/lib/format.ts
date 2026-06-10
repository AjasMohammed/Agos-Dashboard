/** Human-facing formatters shared across feature pages. */

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const DIVISIONS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "seconds"],
  [60, "minutes"],
  [24, "hours"],
  [7, "days"],
  [4.34524, "weeks"],
  [12, "months"],
  [Number.POSITIVE_INFINITY, "years"],
];

/** "3 minutes ago" / "in 2 days" from an RFC3339 timestamp. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  let duration = (date.getTime() - Date.now()) / 1000;
  for (const [amount, unit] of DIVISIONS) {
    if (Math.abs(duration) < amount) return rtf.format(Math.round(duration), unit);
    duration /= amount;
  }
  return rtf.format(Math.round(duration), "years");
}

/** Locale absolute timestamp, e.g. for tooltips. */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** Byte count → "1.4 MiB". */
export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

/** Token count → "12.3k". */
export function tokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** USD amount with adaptive precision for tiny inference costs. */
export function usd(n: number | null | undefined): string {
  if (n == null) return "—";
  const digits = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Compact, human-readable scalar for a JSON value inside event details. */
function scalar(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} items` : "{…}";
  return String(v);
}

/**
 * Audit/event `details` arrive as a JSON-encoded string. Turn an object payload
 * into a readable "key: value · key: value" summary; pass plain text through
 * unchanged. Falls back to the original string if it isn't valid JSON.
 */
export function eventDetails(details: string | null | undefined): string {
  if (!details) return "—";
  const trimmed = details.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(scalar).join(", ");
    if (parsed && typeof parsed === "object") {
      const parts = Object.entries(parsed as Record<string, unknown>).map(
        ([k, v]) => `${k}: ${scalar(v)}`,
      );
      return parts.length ? parts.join(" · ") : trimmed;
    }
    return scalar(parsed);
  } catch {
    return trimmed;
  }
}

/** snake_case / camelCase key → "Title Case" label. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** One field in a parsed event-details payload. */
export type EventField = {
  /** Original JSON key. */
  key: string;
  /** Humanized label for display. */
  label: string;
  /** Scalar display value (compact). */
  value: string;
  /** Pretty-printed JSON when the value is an object/array, else null. */
  nested: string | null;
};

/** Structured view of event `details` for an expandable UI. */
export type ParsedEventDetails =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "fields"; fields: EventField[] };

/**
 * Parse an audit/event `details` JSON string into a structure suited to a
 * friendly key/value UI. Non-JSON or scalar payloads come back as `text`.
 */
export function parseEventDetails(details: string | null | undefined): ParsedEventDetails {
  if (!details || !details.trim()) return { kind: "empty" };
  const trimmed = details.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const fields = Object.entries(parsed).map(([key, v]) => {
        const isComplex = v != null && typeof v === "object";
        return {
          key,
          label: humanizeKey(key),
          value: scalar(v),
          nested: isComplex ? JSON.stringify(v, null, 2) : null,
        };
      });
      if (fields.length) return { kind: "fields", fields };
    } catch {
      /* fall through to text */
    }
  }
  return { kind: "text", text: trimmed };
}
