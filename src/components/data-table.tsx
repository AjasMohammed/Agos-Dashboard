import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  /** Stable key for the column. */
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headClassName?: string;
  /** Right-align numeric columns (also switches on tabular figures). */
  align?: "left" | "right";
}

/**
 * Presentational table. Sorting/filtering/pagination are server-driven (bound
 * to URL search params by the calling page), so the table stays dumb. Rows with
 * a click handler are keyboard-operable (Enter/Space) and announce as buttons.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  footer,
  emptyMessage = "Nothing to show.",
  maxHeight,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /**
   * Row activation. Rows stay real table rows (no role override, so assistive
   * tech keeps the column structure); they are focusable and Enter/Space open
   * them. Controls inside a cell keep their own behaviour.
   */
  /** Rendered below the rows — pagination, totals. */
  footer?: ReactNode;
  emptyMessage?: ReactNode;
  /** Scroll the body inside the frame (sticky header) instead of growing the page. */
  maxHeight?: string;
  className?: string;
}) {
  const INTERACTIVE = "a,button,input,select,textarea,[role=button],[role=menuitem]";
  // Only the row itself: a button or link inside a cell keeps its own keys and clicks.
  function onKey(e: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick || e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick(row);
    }
  }
  function onClick(e: MouseEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick || (e.target as HTMLElement).closest(INTERACTIVE)) return;
    onRowClick(row);
  }
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="relative w-full overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-sm">
          <TableHeader className={cn(maxHeight && "sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_hsl(var(--border))]")}>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(col.align === "right" && "text-right", col.headClassName)}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow
                key={getRowId(row)}
                onClick={onRowClick ? (e) => onClick(e, row) : undefined}
                onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  onRowClick &&
                    "cursor-pointer focus-visible:outline-none focus-visible:bg-muted/60",
                )}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn(col.align === "right" && "tnum text-right", col.className)}
                  >
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}
