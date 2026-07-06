import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap, unwrapList, authedFetch } from "../client";
import type {
  FileMeta,
  PageSummary,
  ScratchPage,
  CostSummaryEntry,
  ConfigTree,
  DoctorReport,
  LogLine,
  ResourceInfo,
} from "../models";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ── Files ───────────────────────────────────────────────────────────────────
export const fileKeys = { all: ["files"] as const };
export function useFiles(enabled = true) {
  return useQuery({
    queryKey: fileKeys.all,
    queryFn: async () => unwrapList<FileMeta>(await client.GET("/api/v1/files")),
    enabled,
  });
}
export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/files/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.all }),
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    // Multipart upload via authedFetch (openapi-fetch + FormData is awkward).
    // No content-type header — the browser sets the multipart boundary.
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authedFetch(`${API_BASE}/api/v1/files`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.all }),
  });
}

// ── Scratchpad ──────────────────────────────────────────────────────────────
export function useScratchpad() {
  return useQuery({
    queryKey: ["scratchpad"],
    queryFn: async () =>
      unwrap<{ pages: PageSummary[] }>(await client.GET("/api/v1/scratchpad")),
  });
}

export function useScratchPage(page: string, enabled: boolean) {
  return useQuery({
    queryKey: ["scratchpad", page],
    queryFn: async () =>
      unwrap<ScratchPage>(
        await client.GET("/api/v1/scratchpad/{page}", { params: { path: { page } } }),
      ),
    enabled: enabled && Boolean(page),
  });
}

export function useSaveScratchPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { page: string; content: string; tags?: string[] }) =>
      unwrap<ScratchPage>(
        await client.PUT("/api/v1/scratchpad/{page}", {
          params: { path: { page: vars.page } },
          body: { content: vars.content, tags: vars.tags ?? [] },
        }),
      ),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["scratchpad"] });
      qc.invalidateQueries({ queryKey: ["scratchpad", vars.page] });
    },
  });
}

// ── Secrets ─────────────────────────────────────────────────────────────────
export const secretKeys = { all: ["secrets"] as const };
export function useSecrets() {
  return useQuery({
    queryKey: secretKeys.all,
    queryFn: async () => {
      const data = unwrap<unknown>(await client.GET("/api/v1/secrets"));
      return (Array.isArray(data) ? data : []) as Array<{ name?: string; scope?: unknown }>;
    },
  });
}
export function useSetSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; value: string; scope?: string }) =>
      unwrap(await client.POST("/api/v1/secrets", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: secretKeys.all }),
  });
}
export function useDeleteSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      unwrap(await client.DELETE("/api/v1/secrets/{name}", { params: { path: { name } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: secretKeys.all }),
  });
}

// ── Costs ───────────────────────────────────────────────────────────────────
export function useCosts() {
  return useQuery({
    queryKey: ["costs"],
    queryFn: async () =>
      unwrap<CostSummaryEntry[]>(await client.GET("/api/v1/costs/summary")),
  });
}

// ── Config ──────────────────────────────────────────────────────────────────
export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => unwrap<ConfigTree>(await client.GET("/api/v1/config")),
  });
}

export function useSetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { key: string; value: string }) => {
      // The config value is a JSON value; parse so `5`/`true`/`"x"` set the
      // right type, falling back to the raw string.
      let value: unknown = vars.value;
      try {
        value = JSON.parse(vars.value);
      } catch {
        /* keep as string */
      }
      return unwrap(
        await client.PUT("/api/v1/config/{key}", {
          params: { path: { key: vars.key } },
          body: { value: value as never },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
  });
}

// ── Doctor ──────────────────────────────────────────────────────────────────
export function useDoctor() {
  return useQuery({
    queryKey: ["doctor"],
    queryFn: async () => unwrap<DoctorReport>(await client.GET("/api/v1/doctor")),
  });
}
export function useDoctorFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap<DoctorReport>(await client.POST("/api/v1/doctor/fix", { body: {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctor"] }),
  });
}

// ── Logs ────────────────────────────────────────────────────────────────────
export function useLogs() {
  return useQuery({
    queryKey: ["logs"],
    queryFn: async () =>
      unwrap<LogLine[]>(await client.GET("/api/v1/logs", { params: { query: { limit: 200 } } })),
  });
}

// ── Resources ───────────────────────────────────────────────────────────────
export function useResources() {
  return useQuery({
    queryKey: ["resources"],
    queryFn: async () => unwrap<ResourceInfo>(await client.GET("/api/v1/resources")),
  });
}
