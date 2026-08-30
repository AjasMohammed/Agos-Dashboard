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
 *
 * Phase order matters: in v5 `isPending` is just `status === "pending"`, which
 * is also true for a query that is **disabled** (`enabled: false`) or **paused**
 * (browser offline — the client keeps the default `networkMode: "online"`).
 * Neither is fetching and neither will ever resolve, so gating the skeleton on
 * `isPending` left those surfaces shimmering forever with no error and no
 * retry. `isLoading` (`isPending && isFetching`) is the real "first load in
 * flight"; everything else pending is `idle`.
 *
 * `idle` is its own slot and renders **nothing** by default: the data was never
 * requested, so the caller's affirmative empty copy ("No episodic memory yet.")
 * would be a claim about data nobody asked for. Paused (offline) is the one idle
 * case with something true to say.
 */
export function QueryState<T>({
  query,
  skeleton,
  empty,
  idle,
  isEmpty,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  empty?: ReactNode;
  /** Shown for a disabled query — one that was never asked to load. */
  idle?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const phase = query.isError
    ? "error"
    : query.isLoading
      ? "pending"
      : query.isPending
        ? "idle"
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
        {phase === "idle" &&
          (query.fetchStatus === "paused" ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Offline — this will load when you reconnect.
            </p>
          ) : (
            idle
          ))}
        {phase === "empty" && empty}
        {phase === "data" && children(query.data as T)}
      </motion.div>
    </AnimatePresence>
  );
}
