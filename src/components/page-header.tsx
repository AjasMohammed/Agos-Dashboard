import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page title row. Plain type on the page surface — no card, no eyebrow — so the
 * first thing an operator reads is the page's name and what it is for.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  back,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Chips/badges shown under the description (status, ids, counts). */
  meta?: ReactNode;
  /** A back link rendered above the title on detail pages. */
  back?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        // Stacked on phones so the description keeps a readable measure; side
        // by side from `sm` up with the actions pinned to the right.
        "mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-x-6",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
        )}
        {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      )}
    </header>
  );
}

/** Heading for a section inside a page (a list, a card group). */
export function SectionHeader({
  title,
  description,
  actions,
  count,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {count != null && (
            <span className="tnum rounded-sm bg-muted px-1.5 text-xs font-medium text-muted-foreground">
              {count}
            </span>
          )}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
