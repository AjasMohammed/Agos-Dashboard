import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import type { ScheduleSummary, PipelineSummary, WorkflowSummary } from "../models";

// ── Schedules ───────────────────────────────────────────────────────────────
export const scheduleKeys = { all: ["schedules"] as const };
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
    onSuccess: () => qc.invalidateQueries({ queryKey: scheduleKeys.all }),
  });
}

// ── Pipelines ───────────────────────────────────────────────────────────────
export const pipelineKeys = { all: ["pipelines"] as const };
export function usePipelines() {
  return useQuery({
    queryKey: pipelineKeys.all,
    queryFn: async () => unwrap<PipelineSummary[]>(await client.GET("/api/v1/pipelines")),
  });
}
export function useRunPipeline() {
  return useMutation({
    mutationFn: async (vars: { name: string; input: string; agent_name?: string }) =>
      unwrap(
        await client.POST("/api/v1/pipelines/{name}/run", {
          params: { path: { name: vars.name } },
          body: { name: vars.name, input: vars.input, agent_name: vars.agent_name, detach: true },
        }),
      ),
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

/** Save (create or update) a pipeline from a JSON definition (JSON is valid YAML). */
export function useSavePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; definition: Record<string, unknown> }) =>
      unwrap(await client.POST("/api/v1/pipelines", { body: vars })),
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

// ── Workflows ───────────────────────────────────────────────────────────────
export const workflowKeys = { all: ["workflows"] as const };
export function useWorkflows() {
  return useQuery({
    queryKey: workflowKeys.all,
    queryFn: async () => unwrap<WorkflowSummary[]>(await client.GET("/api/v1/workflows")),
  });
}

/**
 * Full stored workflow document (opaque JSON; includes the merged-in id), used
 * to seed the editor dialog.
 */
export async function fetchWorkflowDefinition(id: string) {
  // The contract types the stored document as an opaque value; it is always a
  // JSON object on disk (the API rejects anything else on save).
  const doc = unwrap<unknown>(await client.GET("/api/v1/workflows/{id}", { params: { path: { id } } }));
  return doc as Record<string, unknown>;
}

/** Create (no id) or update (id) a workflow; the definition is opaque JSON. */
export function useSaveWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id?: string; name: string; definition: Record<string, unknown> }) => {
      const body = { name: vars.name, definition: vars.definition };
      return vars.id
        ? unwrap<{ id: string }>(
            await client.PUT("/api/v1/workflows/{id}", {
              params: { path: { id: vars.id } },
              body,
            }),
          )
        : unwrap<{ id: string }>(await client.POST("/api/v1/workflows", { body }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowKeys.all }),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/workflows/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowKeys.all }),
  });
}
