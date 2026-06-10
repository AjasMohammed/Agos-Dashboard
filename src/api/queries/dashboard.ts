import { useQuery } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import type { DashboardSummary } from "../models";

export const dashboardKey = ["dashboard"] as const;

export function useDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: async () => unwrap<DashboardSummary>(await client.GET("/api/v1/dashboard")),
  });
}
