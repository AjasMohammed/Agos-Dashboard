import { useQuery } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import { useDisconnectedPolling } from "@/realtime/cacheBridge";
import type { DashboardSummary } from "../models";

export const dashboardKey = ["dashboard"] as const;

export function useDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: async () => unwrap<DashboardSummary>(await client.GET("/api/v1/dashboard")),
    // Poll only while the WS is down (see useTasks).
    refetchInterval: useDisconnectedPolling(),
  });
}
