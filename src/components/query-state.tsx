import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

function DefaultSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
      <AlertTriangle className="mb-2 size-7 text-destructive" />
      <p className="font-medium">Couldn’t load this</p>
      <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}

/**
 * Render loading/error/empty/data states for a TanStack query in one place, so
 * feature pages stay focused on the success view. States crossfade so the
 * skeleton→data swap doesn't flash.
 */
export function QueryState<T>({
  query,
  skeleton,
  empty,
  isEmpty,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const phase = query.isPending
    ? "pending"
    : query.isError
      ? "error"
      : isEmpty?.(query.data)
        ? "empty"
        : "data";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={phase}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        {phase === "pending" && (skeleton ?? <DefaultSkeleton />)}
        {phase === "error" && <ErrorState error={query.error} retry={() => void query.refetch()} />}
        {phase === "empty" && empty}
        {phase === "data" && children(query.data as T)}
      </motion.div>
    </AnimatePresence>
  );
}
