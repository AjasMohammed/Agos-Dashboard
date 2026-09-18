export type Tone = "success" | "warning" | "danger" | "muted" | "info";

/**
 * Map a status string to a tone. Unknown values are `muted`.
 *
 * Lives in `lib/` rather than next to `StatusBadge` so anything colouring the
 * same status beside a badge — a `Stat` value, a chart series — reads the same
 * table and cannot tell a different story about the same word. (It is also why
 * it is not exported from the component file: a non-component export there
 * breaks React Fast Refresh.)
 */
export function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  // In-flight first: "running" is work happening, not a success.
  if (["running", "in_progress", "streaming", "connecting"].includes(s)) return "info";
  if (
    [
      "online",
      "active",
      "complete",
      "completed",
      "ok",
      "healthy",
      "connected",
      "enabled",
      "resolved",
      "pass",
      "passed",
      "success",
      "succeeded",
    ].includes(s)
  ) {
    return "success";
  }
  if (
    ["pending", "paused", "degraded", "lagged", "warning", "queued", "warn", "expiring"].includes(s)
  ) {
    return "warning";
  }
  if (
    [
      "offline",
      "error",
      "failed",
      "blocked",
      "stopped",
      "denied",
      "disabled",
      "cancelled",
      "canceled",
      "fail",
      "critical",
    ].includes(s)
  ) {
    return "danger";
  }
  return "muted";
}
