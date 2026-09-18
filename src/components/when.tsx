import { absoluteTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A timestamp shown relative ("4 min ago") with the absolute time on hover and
 * in the accessibility tree. Relative alone is unciteable in an incident and
 * absolute alone is unscannable, so every timestamp in the panel carries both.
 */
export function When({
  iso,
  className,
  prefix,
}: {
  iso: string | null | undefined;
  className?: string;
  /** Leading word, e.g. "connected" — kept inside the element so it wraps as one. */
  prefix?: string;
}) {
  if (!iso) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <time dateTime={iso} title={absoluteTime(iso)} className={cn("whitespace-nowrap", className)}>
      {prefix ? `${prefix} ` : ""}
      {relativeTime(iso)}
    </time>
  );
}
