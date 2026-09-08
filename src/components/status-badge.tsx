import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "muted" | "info";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-info/12 text-info",
  muted: "bg-muted text-muted-foreground",
};

/** Statuses that represent live, in-flight work get a gently pulsing dot. */
const LIVE = new Set(["running", "in_progress", "streaming", "connecting", "queued", "pending"]);

/** Map common status strings to a tone. Unknown values render muted. */
function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  // In-flight first: "running" is work happening, not a success.
  if (["running", "in_progress", "streaming", "connecting"].includes(s)) return "info";
  if (["online", "active", "complete", "completed", "ok", "healthy", "connected", "enabled", "resolved", "pass", "passed", "success", "succeeded"].includes(s)) {
    return "success";
  }
  if (["pending", "paused", "degraded", "lagged", "warning", "queued", "warn", "expiring"].includes(s)) {
    return "warning";
  }
  if (["offline", "error", "failed", "blocked", "stopped", "denied", "disabled", "cancelled", "canceled", "fail", "critical"].includes(s)) {
    return "danger";
  }
  return "muted";
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const live = LIVE.has(status.toLowerCase());
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-px text-xs font-medium capitalize leading-4",
        TONE_CLASS[toneFor(status)],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full bg-current", live && "animate-pulse")}
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}
