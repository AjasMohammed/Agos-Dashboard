import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import type { ToolSummary } from "../models";

export const toolKeys = { all: ["tools"] as const };

export function useTools() {
  return useQuery({
    queryKey: toolKeys.all,
    queryFn: async () => unwrap<ToolSummary[]>(await client.GET("/api/v1/tools")),
  });
}

export function useInstallTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (manifestPath: string) =>
      unwrap(await client.POST("/api/v1/tools", { body: { manifest_path: manifestPath } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: toolKeys.all }),
  });
}

export function useRemoveTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      unwrap(await client.DELETE("/api/v1/tools/{name}", { params: { path: { name } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: toolKeys.all }),
  });
}
