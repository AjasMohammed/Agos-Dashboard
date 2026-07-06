import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, client, unwrap, unwrapList } from "../client";
import { useDisconnectedPolling } from "@/realtime/cacheBridge";
import type {
  CheckpointSummary,
  RunTaskRequest,
  TaskDetail,
  TaskSummary,
  TaskTrace,
} from "../models";

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
    // Live updates arrive over WS; poll only while the socket is down so the
    // list doesn't silently go stale during a reconnect.
    refetchInterval: useDisconnectedPolling(),
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
    queryFn: async (): Promise<TaskTrace | null> => {
      try {
        // The contract types the trace payload as an untyped `Value`; guard the
        // one load-bearing field (`iterations`) before trusting the shape, so
        // backend drift renders the empty state instead of throwing through the
        // render tree.
        const raw = unwrap<unknown>(
          await client.GET("/api/v1/tasks/{id}/trace", { params: { path: { id } } }),
        );
        if (
          !raw ||
          typeof raw !== "object" ||
          !Array.isArray((raw as { iterations?: unknown }).iterations)
        ) {
          // Present but wrong shape (a 404 is handled in the catch below). Warn
          // so backend drift is visible rather than silently returning empty.
          console.warn("task trace payload shape drift", id);
          return null;
        }
        return raw as TaskTrace;
      } catch (err) {
        // No trace for this task (pre-trace-system tasks, or a task that was
        // running across a kernel restart) — show the empty state, not an error.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    // Live progress: while the task is unfinished (or has no trace yet), poll;
    // stop once finished_at is set — the persisted trace no longer changes.
    refetchInterval: (query) => {
      const trace = query.state.data;
      return !trace || trace.finished_at == null ? 5000 : false;
    },
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
