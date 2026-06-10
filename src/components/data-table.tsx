import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  /** Stable key for the column. */
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headClassName?: string;
}

/**
 * Lightweight presentational table. Sorting/filtering/pagination are server-driven
 * (bound to URL search params by the calling page), so the table itself stays dumb.
 * Rows fade in with a short cascade (capped so long lists don't crawl); realtime
 * cache updates re-render in place without re-animating.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              <TableHead key={col.key} className={col.headClassName}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <motion.tr
              key={getRowId(row)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-border transition-colors last:border-0 hover:bg-muted/40",
                onRowClick && "cursor-pointer",
              )}
            >
              {columns.map((col) => (
                <TableCell key={col.key} className={col.className}>
                  {col.cell(row)}
                </TableCell>
              ))}
            </motion.tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
