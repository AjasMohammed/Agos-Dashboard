import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap, unwrapList } from "../client";
import type { CheckpointSummary, RunTaskRequest, TaskDetail, TaskSummary } from "../models";

export interface TaskFilter {
  status?: string;
  agent_name?: string;
  limit?: number;
  offset?: number;
}

export const taskKeys = {
  all: ["tasks"] as const,
  list: (filter: TaskFilter) => ["tasks", "list", filter] as const,
  detail: (id: string) => ["tasks", id] as const,
  trace: (id: string) => ["tasks", id, "trace"] as const,
};

export function useTasks(filter: TaskFilter) {
  return useQuery({
    queryKey: taskKeys.list(filter),
    queryFn: async () =>
      unwrapList<TaskSummary>(await client.GET("/api/v1/tasks", { params: { query: filter } })),
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: async () =>
      unwrap<TaskDetail>(await client.GET("/api/v1/tasks/{id}", { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

export function useTaskTrace(id: string, enabled: boolean) {
  return useQuery({
    queryKey: taskKeys.trace(id),
    queryFn: async () =>
      unwrap<unknown>(await client.GET("/api/v1/tasks/{id}/trace", { params: { path: { id } } })),
    enabled: enabled && Boolean(id),
  });
}

export function useTaskCheckpoints(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["tasks", id, "checkpoints"],
    queryFn: async () =>
      unwrap<CheckpointSummary[]>(
        await client.GET("/api/v1/tasks/{id}/checkpoints", { params: { path: { id } } }),
      ),
    enabled: enabled && Boolean(id),
  });
}

export function useRunTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RunTaskRequest) =>
      unwrap<unknown>(await client.POST("/api/v1/tasks/run", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.POST("/api/v1/tasks/{id}/cancel", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useResumeTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.POST("/api/v1/tasks/{id}/resume", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  });
}
