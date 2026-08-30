import { useEffect, useRef } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { useChannel } from "./useChannel";
import { useRealtimeStatus } from "./connection";

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
  // A debounced invalidation queued right before unmount would otherwise still
  // fire and refetch queries the page no longer shows. `channel` is a dep, not
  // just unmount: switching channels (`tasks:a` → `tasks:b`) must not leave a
  // queued invalidation armed against the previous render's keys. `queryKeys` is
  // deliberately *not* a dep — callers pass a fresh array literal every render,
  // so it would clear the timer before it ever fired and defeat the debounce.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [channel],
  );
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
 * Returns a `refetchInterval` value for TanStack queries that polls only while
 * the realtime socket is down, and stops (false) once it reconnects — so live
 * data stays fresh without WS, with no redundant polling when WS is healthy.
 */
export function useDisconnectedPolling(intervalMs = 10_000): number | false {
  const status = useRealtimeStatus((s) => s.status);
  return status === "open" ? false : intervalMs;
}
