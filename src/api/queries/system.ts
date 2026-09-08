import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap, unwrapList, authedFetch } from "../client";
import { isArtifact } from "@/lib/artifact-kind";
import type {
  ApiKeyMeta,
  CreateKeyRequest,
  IssuedKey,
  FileMeta,
  PageSummary,
  ScratchPage,
  CostSummaryEntry,
  ConfigTree,
  DoctorReport,
  LogLine,
  ResourceInfo,
  SystemStatus,
  HalInfo,
} from "../models";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/**
 * Single-view keys that have no factory of their own. Declared here rather than
 * inline at the `useQuery` call so `keys.test.ts` can enumerate them — an inline
 * key is invisible to the prefix check that keeps invalidations from cancelling
 * each other.
 */
export const systemKeys = {
  costs: ["costs"] as const,
  config: ["config"] as const,
  doctor: ["doctor"] as const,
  logs: (limit: number) => ["logs", limit] as const,
  resources: ["resources"] as const,
  status: ["system-status"] as const,
  hal: ["hal"] as const,
};

// ── Files ───────────────────────────────────────────────────────────────────
export const fileKeys = { all: ["files"] as const };
export function useFiles(enabled = true) {
  return useQuery({
    queryKey: fileKeys.all,
    queryFn: async () => unwrapList<FileMeta>(await client.GET("/api/v1/files")),
    enabled,
  });
}
/**
 * One agent-written artifact: registry row + its bytes.
 *
 * Key is `["artifact", id]`, deliberately NOT nested under `fileKeys.all`
 * (`["files"]`) — a prefix invalidation from the Files page would otherwise
 * cancel an in-flight artifact fetch (see the prefix rule in CLAUDE.md).
 * `artifact-write` caps an artifact at 2 MiB, so holding the text in the cache
 * is bounded.
 */
export const artifactKeys = { one: (id: string) => ["artifact", id] as const };
export function useArtifact(id: string) {
  return useQuery({
    queryKey: artifactKeys.one(id),
    queryFn: async () => {
      const meta = unwrap<FileMeta>(
        await client.GET("/api/v1/files/{id}", { params: { path: { id } } }),
      );
      // Only an artifact's bytes are read as text. An ordinary upload can be a
      // multi-GB binary, and the page shows it through `FilePreview` (which
      // decides by mime) instead — no reason to pull it here.
      if (!isArtifact(meta)) return { meta, text: "" };
      // `timeoutMs: null` for the same reason as the Files download: the 30s
      // deadline aborts mid-body and surfaces as a bare AbortError.
      const res = await authedFetch(`${API_BASE}/api/v1/files/${id}/download`, {}, null);
      if (!res.ok) throw new Error(`Could not read artifact (${res.status})`);
      return { meta, text: await res.text() };
    },
    // Artifacts are immutable once written (a rewrite mints a new id), so a
    // refetch on every window focus is pure waste.
    staleTime: Infinity,
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

const UPLOAD_TIMEOUT_MS = 10 * 60_000;

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    // Multipart upload via authedFetch (openapi-fetch + FormData is awkward).
    // No content-type header — the browser sets the multipart boundary.
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      // Uploads are sized by the network, not by the JSON-call deadline.
      const res = await authedFetch(
        `${API_BASE}/api/v1/files`,
        { method: "POST", body: fd },
        UPLOAD_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.all }),
  });
}

// ── Scratchpad ──────────────────────────────────────────────────────────────
// `page` nests under `all` on purpose — see `useSaveScratchPage`.
export const scratchpadKeys = {
  all: ["scratchpad"] as const,
  page: (page: string) => ["scratchpad", page] as const,
};
export function useScratchpad() {
  return useQuery({
    queryKey: scratchpadKeys.all,
    queryFn: async () =>
      unwrap<{ pages: PageSummary[] }>(await client.GET("/api/v1/scratchpad")),
  });
}

export function useScratchPage(page: string, enabled: boolean) {
  return useQuery({
    queryKey: scratchpadKeys.page(page),
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
    // `["scratchpad"]` is the prefix of the page key, so it already covers the
    // page that was just saved — a second, narrower call would be redundant.
    onSuccess: () => qc.invalidateQueries({ queryKey: scratchpadKeys.all }),
  });
}

// ── Secrets ─────────────────────────────────────────────────────────────────
export const secretKeys = { all: ["secrets"] as const };
export function useSecrets(enabled = true) {
  return useQuery({
    enabled,
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
    // `scope` is REQUIRED by the API on purpose (no default: `global` exposes
    // the secret to every agent and tool), so it is required here too — an
    // optional field just moved the failure to a 400 at runtime.
    mutationFn: async (body: { name: string; value: string; scope: string }) =>
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
    queryKey: systemKeys.costs,
    queryFn: async () =>
      unwrap<CostSummaryEntry[]>(await client.GET("/api/v1/costs/summary")),
  });
}

// ── Config ──────────────────────────────────────────────────────────────────
export function useConfig() {
  return useQuery({
    queryKey: systemKeys.config,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: systemKeys.config }),
  });
}

// ── Doctor ──────────────────────────────────────────────────────────────────
export function useDoctor() {
  return useQuery({
    queryKey: systemKeys.doctor,
    queryFn: async () => unwrap<DoctorReport>(await client.GET("/api/v1/doctor")),
  });
}
export function useDoctorFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap<DoctorReport>(await client.POST("/api/v1/doctor/fix", { body: {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: systemKeys.doctor }),
  });
}

// ── Logs ────────────────────────────────────────────────────────────────────
export function useLogs(limit = 200) {
  return useQuery({
    queryKey: systemKeys.logs(limit),
    queryFn: async () =>
      unwrap<LogLine[]>(await client.GET("/api/v1/logs", { params: { query: { limit } } })),
  });
}

// ── Resources ───────────────────────────────────────────────────────────────
export function useResources() {
  return useQuery({
    queryKey: systemKeys.resources,
    queryFn: async () => unwrap<ResourceInfo>(await client.GET("/api/v1/resources")),
  });
}

// ── API keys ────────────────────────────────────────────────────────────────
export const apiKeyKeys = { all: ["api-keys"] as const };
export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyKeys.all,
    queryFn: async () => unwrap<ApiKeyMeta[]>(await client.GET("/api/v1/keys")),
  });
}
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    // Returns the full key exactly once — the caller must show/copy it immediately.
    mutationFn: async (body: CreateKeyRequest) =>
      unwrap<IssuedKey>(await client.POST("/api/v1/keys", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: apiKeyKeys.all }),
  });
}
export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/keys/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: apiKeyKeys.all }),
  });
}

// ── System status + HAL ─────────────────────────────────────────────────────
export function useSystemStatus() {
  return useQuery({
    queryKey: systemKeys.status,
    queryFn: async () => unwrap<SystemStatus>(await client.GET("/api/v1/status")),
  });
}
export function useHal() {
  return useQuery({
    queryKey: systemKeys.hal,
    queryFn: async () => unwrap<HalInfo>(await client.GET("/api/v1/hal")),
  });
}

export function useDeleteScratchPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (page: string) => {
      unwrap(await client.DELETE("/api/v1/scratchpad/{page}", { params: { path: { page } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: scratchpadKeys.all }),
  });
}
