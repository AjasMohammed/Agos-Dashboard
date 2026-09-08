import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import { taskKeys } from "./tasks";
import type { ScheduleRun, ScheduleSummary, PipelineSummary } from "../models";

// ── Schedules ───────────────────────────────────────────────────────────────
// `runs` sits in its own namespace rather than under `all`: every pause/resume/
// delete invalidates `all`, and while run history nested beneath it those
// mutations also cancelled the open run-history dialog's fetch.
export const scheduleKeys = {
  all: ["schedules"] as const,
  runs: (id: string) => ["schedule-runs", id] as const,
};
export function useSchedules() {
  return useQuery({
    queryKey: scheduleKeys.all,
    queryFn: async () => unwrap<ScheduleSummary[]>(await client.GET("/api/v1/schedules")),
  });
}
export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      agent_name: string;
      cron: string;
      prompt: string;
      delivery_mode: string;
    }) => unwrap(await client.POST("/api/v1/schedules", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: scheduleKeys.all }),
  });
}

/** Run history for one schedule — fetched only while its dialog is open. */
export function useScheduleRuns(id: string | null) {
  return useQuery({
    queryKey: scheduleKeys.runs(id ?? ""),
    queryFn: async () =>
      unwrap<ScheduleRun[]>(
        await client.GET("/api/v1/schedules/{id}/runs", { params: { path: { id: id! } } }),
      ),
    enabled: id != null,
  });
}

export function usePreviewCron() {
  return useMutation({
    mutationFn: async (cron: string) =>
      unwrap<{ next_runs: string[] }>(
        await client.POST("/api/v1/schedules/preview", { body: { cron } }),
      ),
  });
}

export function useToggleSchedule(action: "pause" | "resume") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const path = `/api/v1/schedules/{id}/${action}` as
        | "/api/v1/schedules/{id}/pause"
        | "/api/v1/schedules/{id}/resume";
      unwrap(await client.POST(path, { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: scheduleKeys.all }),
  });
}
export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/schedules/{id}", { params: { path: { id } } }));
    },
    onSuccess: (_res, id) => {
      qc.removeQueries({ queryKey: scheduleKeys.runs(id) });
      return qc.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

// ── Pipelines ───────────────────────────────────────────────────────────────
// `runEvents` is namespaced away from `all` for the same reason as schedule
// runs: a delete/import must not cancel an open run dialog's poll.
export const pipelineKeys = {
  all: ["pipelines"] as const,
  runEvents: (runId: string) => ["pipeline-runs", runId] as const,
};
export function usePipelines() {
  return useQuery({
    queryKey: pipelineKeys.all,
    queryFn: async () => unwrap<PipelineSummary[]>(await client.GET("/api/v1/pipelines")),
  });
}
export function useRunPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; input: string; agent_name?: string }) =>
      unwrap(
        await client.POST("/api/v1/pipelines/{name}/run", {
          params: { path: { name: vars.name } },
          body: { name: vars.name, input: vars.input, agent_name: vars.agent_name, detach: true },
        }),
      ),
    // A detached run materialises as kernel tasks; without this the activity
    // list shows nothing until its next poll.
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  });
}
export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      unwrap(await client.DELETE("/api/v1/pipelines/{name}", { params: { path: { name } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}

/** Install (create) a pipeline from a raw YAML definition. */
export function useImportPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (yaml: string) =>
      unwrap(await client.POST("/api/v1/pipelines/import", { body: { yaml } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}

/** Full pipeline definition as JSON (parsed from the stored YAML), for the builder. */
export async function fetchPipelineDefinition(name: string) {
  const def = unwrap<unknown>(
    await client.GET("/api/v1/pipelines/{name}", { params: { path: { name } } }),
  );
  return def as Record<string, unknown>;
}

/**
 * Save (create or update) a pipeline from a JSON definition (JSON is valid
 * YAML). Without `overwrite` the API answers **409 Conflict** when the name is
 * already taken — the store writes `INSERT OR REPLACE`, so an unguarded save
 * would silently clobber a production definition and report success.
 */
export function useSavePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      definition: Record<string, unknown>;
      overwrite?: boolean;
    }) => unwrap(await client.POST("/api/v1/pipelines", { body: vars })),
    onSuccess: () => qc.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}

/** Download a pipeline's YAML definition as a file. */
export async function exportPipeline(name: string) {
  const res = unwrap<{ name: string; yaml: string }>(
    await client.GET("/api/v1/pipelines/{name}/export", { params: { path: { name } } }),
  );
  const url = URL.createObjectURL(new Blob([res.yaml], { type: "application/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${res.name}.yaml`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Run states the kernel never moves out of — the spellings it emits, lowercased. */
const TERMINAL_RUN_STATUS = new Set(["complete", "completed", "failed", "cancelled", "error"]);

/**
 * Snapshot of a detached pipeline run (steps, statuses, outputs). Polls while
 * the dialog is open; the payload is an untyped kernel Value rendered as JSON.
 */
export function usePipelineRunEvents(runId: string | null) {
  return useQuery({
    queryKey: pipelineKeys.runEvents(runId ?? ""),
    queryFn: async () =>
      unwrap<unknown>(
        await client.GET("/api/v1/pipelines/runs/{run_id}/events", {
          params: { path: { run_id: runId! } },
        }),
      ) as Record<string, unknown>,
    enabled: runId != null,
    // A finished run's snapshot never changes again, so stop — otherwise this
    // polls every 3s for as long as the tab lives. The payload is an untyped
    // kernel Value, hence the defensive read of `status`.
    refetchInterval: (query) => {
      // An errored query has no `data`, so reading `status` off it falls through
      // to the 3s branch and re-requests the 404 for as long as the dialog stays
      // open. Same guard as `useTaskTrace`.
      if (query.state.status === "error") return false;
      const status = (query.state.data as { status?: unknown } | undefined)?.status;
      return typeof status === "string" && TERMINAL_RUN_STATUS.has(status.toLowerCase())
        ? false
        : 3000;
    },
  });
}
