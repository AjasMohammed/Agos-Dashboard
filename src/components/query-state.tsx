import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { errorMessage } from "@/lib/errors";

function DefaultSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Callout
      tone="danger"
      role="alert"
      title="Couldn’t load this"
      actions={
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      }
    >
      {errorMessage(error)}
    </Callout>
  );
}

/**
 * Render loading/error/empty/idle/data states for a TanStack query in one
 * place, so feature pages stay focused on the success view.
 *
 * Phase order matters: in v5 `isPending` is just `status === "pending"`, which
 * is also true for a query that is **disabled** (`enabled: false`) or **paused**
 * (browser offline — the client keeps the default `networkMode: "online"`).
 * Neither is fetching and neither will ever resolve, so gating the skeleton on
 * `isPending` left those surfaces shimmering forever with no error and no
 * retry. `isLoading` (`isPending && isFetching`) is the real "first load in
 * flight"; everything else pending is `idle`.
 *
 * `idle` renders **nothing** by default: the data was never requested, so the
 * caller's affirmative empty copy would be a claim about data nobody asked for.
 * Paused (offline) is the one idle case with something true to say.
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
    <div key={phase} className="animate-fade-in">
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
    </div>
  );
}
