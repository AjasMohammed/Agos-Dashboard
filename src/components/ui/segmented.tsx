import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Optional trailing count. */
  count?: number;
  disabled?: boolean;
}

/**
 * Exclusive-choice control for filters and view toggles (status chips, memory
 * tiers, sort direction…). Buttons with `aria-pressed`, so screen readers get
 * "pressed"/"not pressed" without any custom roles.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ...aria
}: {
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <div
      role="group"
      {...aria}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-muted/60 p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[5px] font-medium text-muted-foreground transition-colors duration-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm",
            size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
          )}
        >
          {o.label}
          {o.count != null && (
            <span className="tnum rounded-sm bg-muted px-1 text-xs text-muted-foreground">
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
