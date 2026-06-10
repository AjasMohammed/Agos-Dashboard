import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "muted" | "info";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-primary/15 text-primary",
  muted: "bg-muted text-muted-foreground",
};

/** Map common status strings to a tone. Unknown values render muted. */
function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  if (["online", "active", "running", "complete", "ok", "healthy", "connected"].includes(s)) {
    return "success";
  }
  if (["pending", "paused", "degraded", "lagged", "warning", "queued"].includes(s)) {
    return "warning";
  }
  if (["offline", "error", "failed", "blocked", "stopped", "denied"].includes(s)) {
    return "danger";
  }
  if (["running", "in_progress", "streaming"].includes(s)) return "info";
  return "muted";
}

/** Statuses that represent live, in-flight work get a gently pulsing dot. */
const LIVE_STATUSES = new Set(["running", "in_progress", "streaming", "connecting", "queued"]);

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const live = LIVE_STATUSES.has(status.toLowerCase());
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        TONE_CLASS[toneFor(status)],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full bg-current", live && "animate-pulse")} />
      {status}
    </span>
  );
}
