import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One number with a label. Replaces the five hand-rolled stat cells that used
 * to live in dashboard, prefs, trace, status and task-status views.
 */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  size = "md",
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  size?: "sm" | "md";
  /** Colour the value — for status counts (failed = danger, running = info). */
  tone?: "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : tone === "info"
            ? "text-info"
            : "";
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border bg-card",
        size === "sm" ? "px-3 py-2.5" : "p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground/70" />}
      </div>
      <p
        className={cn(
          "tnum truncate font-semibold tracking-tight",
          size === "sm" ? "mt-1 text-lg" : "mt-2 text-2xl",
          toneClass,
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Auto-fitting grid so stat rows fill any viewport width without a fixed column count. */
export function StatGrid({
  children,
  min = 180,
  className,
}: {
  children: ReactNode;
  /** Minimum column width in px. */
  min?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-3", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` }}
    >
      {children}
    </div>
  );
}
