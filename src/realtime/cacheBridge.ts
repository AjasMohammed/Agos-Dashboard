import { useRef } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { useChannel } from "./useChannel";
import { useRealtimeStatus } from "./connection";
import type { EventFrame } from "./protocol";

/**
 * Invalidate one or more query keys whenever an event lands on `channel`.
 * High-frequency channels (costs, task-logs) can be coalesced with `debounceMs`.
 */
export function useInvalidateOnEvent(
  channel: string | null | undefined,
  queryKeys: QueryKey[],
  options: { debounceMs?: number } = {},
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useChannel(channel, () => {
    const run = () => queryKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    if (!options.debounceMs) {
      run();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, options.debounceMs);
  });
}

/**
 * Patch a query's cached data in place on each event — avoids a refetch for
 * cheap updates (e.g. a task status badge, a streaming counter).
 */
export function usePatchOnEvent<T>(
  channel: string | null | undefined,
  queryKey: QueryKey,
  updater: (previous: T | undefined, event: EventFrame) => T,
): void {
  useChannel(channel, (event) => {
    queryClient.setQueryData<T>(queryKey, (previous) => updater(previous, event));
  });
}

/**
 * Returns a `refetchInterval` value for TanStack queries that polls only while
 * the realtime socket is down, and stops (false) once it reconnects — so live
 * data stays fresh without WS, with no redundant polling when WS is healthy.
 */
export function useDisconnectedPolling(intervalMs = 10_000): number | false {
  const status = useRealtimeStatus((s) => s.status);
  return status === "open" ? false : intervalMs;
}
