import { cn } from "@/lib/utils";
import { toneFor, type Tone } from "@/lib/status-tone";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-info/12 text-info",
  muted: "bg-muted text-muted-foreground",
};

/** Statuses that represent live, in-flight work get a gently pulsing dot. */
const LIVE = new Set(["running", "in_progress", "streaming", "connecting", "queued", "pending"]);

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
