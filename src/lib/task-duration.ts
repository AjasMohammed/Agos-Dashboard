/** Milliseconds → "12 s" / "3 min 4 s" / "2 h 5 min". Sub-second rounds up to "1 s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return s ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

/** Duration between two RFC3339 timestamps, or null when either is missing/invalid. */
export function durationBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  // Negative = clock skew; better no badge than "took —".
  return Number.isNaN(ms) || ms < 0 ? null : formatDuration(ms);
}
