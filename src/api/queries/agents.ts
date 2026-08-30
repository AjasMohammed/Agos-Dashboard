import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import { useDisconnectedPolling } from "@/realtime/cacheBridge";
import type {
  AgentDetail,
  AgentIdentity,
  AgentSummary,
  ConnectAgentRequest,
  CostSummaryEntry,
  InboxMessage,
  MemoryItem,
  PageSummary,
  ScratchPage,
  UpdateAgentSettingsRequest,
} from "../models";

export type MemoryTier = "episodic" | "semantic" | "procedural";

/**
 * `all` (the list) must not prefix `detail` — `invalidateQueries` matches by
 * prefix, so a list refresh used to refetch every open agent sub-resource too.
 * `root` is the deliberate broad prefix for "anything about agents changed";
 * everything agent-scoped hangs off `detail(name)` and is keyed by **name**,
 * never the UUID, so one agent has exactly one cache namespace.
 */
export const agentKeys = {
  root: ["agents"] as const,
  all: ["agents", "list"] as const,
  detail: (name: string) => ["agents", "detail", name] as const,
  // Sub-resources are declared here rather than spread inline at each call site
  // so `keys.test.ts` can enumerate them — an inline key is invisible to the
  // prefix check that keeps invalidations from cancelling each other.
  identity: (name: string) => ["agents", "detail", name, "identity"] as const,
  costs: (name: string) => ["agents", "detail", name, "costs"] as const,
  memory: (name: string, tier: MemoryTier, q: string) =>
    ["agents", "detail", name, "memory", tier, q] as const,
  inbox: (name: string, limit: number) => ["agents", "detail", name, "inbox", limit] as const,
  scratchpad: (name: string) => ["agents", "detail", name, "scratchpad"] as const,
  scratchPage: (name: string, page: string | null) =>
    ["agents", "detail", name, "scratchpad", page] as const,
};

/**
 * Invalidate everything a profile mutation can change: the row, the list, and
 * the two sub-keys that mirror mutable server state (identity's status badge,
 * the cost/budget snapshot). `exact: true` on `detail` is load-bearing — it is
 * the prefix of every agent sub-key, so a prefix invalidation would also refetch
 * the open scratchpad page and replace whatever the operator had typed. Memory
 * and inbox are left out on purpose: no profile mutation writes to them.
 */
function invalidateAgentProfile(qc: QueryClient, name: string) {
  qc.invalidateQueries({ queryKey: agentKeys.detail(name), exact: true });
  qc.invalidateQueries({ queryKey: agentKeys.identity(name) });
  qc.invalidateQueries({ queryKey: agentKeys.costs(name) });
  qc.invalidateQueries({ queryKey: agentKeys.all });
}

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.all,
    queryFn: async () => unwrap<AgentSummary[]>(await client.GET("/api/v1/agents")),
    // Poll only while the WS is down (see useTasks) — keeps the list fresh
    // without redundant polling when realtime is healthy.
    refetchInterval: useDisconnectedPolling(),
  });
}

export function useAgent(name: string) {
  return useQuery({
    queryKey: agentKeys.detail(name),
    queryFn: async () =>
      unwrap<AgentDetail>(
        await client.GET("/api/v1/agents/{name}", { params: { path: { name } } }),
      ),
    enabled: Boolean(name),
  });
}

export function useConnectAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ConnectAgentRequest) =>
      unwrap<AgentSummary>(await client.POST("/api/v1/agents", { body })),
    onSuccess: (agent) => invalidateAgentProfile(qc, agent.name),
  });
}

export function useDisconnectAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      unwrap(await client.DELETE("/api/v1/agents/{name}", { params: { path: { name } } }));
    },
    onSuccess: (_d, name) => invalidateAgentProfile(qc, name),
  });
}

export function useGrantPermission(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (permission: string) => {
      unwrap(
        await client.POST("/api/v1/agents/{name}/permissions", {
          params: { path: { name } },
          body: { agent_name: name, permission },
        }),
      );
    },
    onSuccess: () => invalidateAgentProfile(qc, name),
  });
}

/**
 * Grant a permission to an agent selected at call time (the `name`-bound
 * `useGrantPermission` above is for a fixed agent, e.g. the detail page).
 * `permission` is the `resource:flags` form, e.g. `events.security:o`.
 */
export function useGrantAgentPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, permission }: { name: string; permission: string }) => {
      unwrap(
        await client.POST("/api/v1/agents/{name}/permissions", {
          params: { path: { name } },
          body: { agent_name: name, permission },
        }),
      );
    },
    onSuccess: (_d, { name }) => invalidateAgentProfile(qc, name),
  });
}

export function useRevokePermission(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (permission: string) => {
      unwrap(
        await client.POST("/api/v1/agents/{name}/permissions/revoke", {
          params: { path: { name } },
          body: { agent_name: name, permission },
        }),
      );
    },
    onSuccess: () => invalidateAgentProfile(qc, name),
  });
}

export function useAgentIdentity(name: string) {
  return useQuery({
    queryKey: agentKeys.identity(name),
    queryFn: async () =>
      unwrap<AgentIdentity>(
        await client.GET("/api/v1/agents/{name}/identity", { params: { path: { name } } }),
      ),
    enabled: Boolean(name),
  });
}

/**
 * Every settings field is optional now: absent = leave unchanged, and
 * `system_prompt: ""` explicitly clears the stored prompt. `agent_name` is
 * filled from the hook's bound name so callers can submit only the fields the
 * form actually touched instead of echoing the whole profile back. (Partial,
 * not Omit, so a caller that still passes `agent_name` keeps compiling — the
 * bound name wins either way, since it is what the path is built from.)
 */
export type AgentSettingsPatch = Partial<UpdateAgentSettingsRequest>;

export function useUpdateAgentSettings(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: AgentSettingsPatch) => {
      unwrap(
        await client.POST("/api/v1/agents/{name}/settings", {
          params: { path: { name } },
          body: { ...patch, agent_name: name },
        }),
      );
    },
    onSuccess: () => invalidateAgentProfile(qc, name),
  });
}

/**
 * Browse or search one memory tier for an agent. Empty `q` → most-recent items;
 * non-empty `q` → tier search. Read-only. `placeholderData` keeps the prior list
 * visible while the tier switches or the query is debounced by typing.
 */
export function useAgentMemory(name: string, tier: MemoryTier, q: string) {
  const trimmed = q.trim();
  return useQuery({
    // Keyed by agent NAME like every other agent-scoped key. These two used to
    // key by the UUID, which forked one agent across two cache namespaces and
    // put them outside the reach of `agentKeys.detail(name)`. The `{id}` path
    // segment resolves a name just as well.
    queryKey: agentKeys.memory(name, tier, trimmed),
    queryFn: async () =>
      unwrap<MemoryItem[]>(
        await client.GET("/api/v1/agents/{id}/memory/{tier}", {
          params: {
            path: { id: name, tier },
            query: trimmed ? { q: trimmed } : {},
          },
        }),
      ),
    enabled: Boolean(name),
    placeholderData: (prev) => prev,
  });
}

/** Agent-to-agent message timeline (read-only). Newest window, oldest-first. */
export function useAgentInbox(name: string, limit = 100) {
  return useQuery({
    queryKey: agentKeys.inbox(name, limit),
    queryFn: async () =>
      unwrap<InboxMessage[]>(
        await client.GET("/api/v1/agents/{id}/inbox", {
          params: { path: { id: name }, query: { limit } },
        }),
      ),
    enabled: Boolean(name),
  });
}

/** Per-agent cost/budget snapshot for the current period. */
export function useAgentCosts(name: string) {
  return useQuery({
    queryKey: agentKeys.costs(name),
    queryFn: async () =>
      unwrap<CostSummaryEntry>(
        await client.GET("/api/v1/costs/agents/{name}", { params: { path: { name } } }),
      ),
    enabled: Boolean(name),
    retry: false, // 404 = no cost data yet; render the empty state, don't hammer
  });
}

// ── Agent-scoped scratchpad ─────────────────────────────────────────────────
export function useAgentScratchpad(name: string) {
  return useQuery({
    queryKey: agentKeys.scratchpad(name),
    queryFn: async () =>
      unwrap<{ pages: PageSummary[] }>(
        await client.GET("/api/v1/agents/{name}/scratchpad", { params: { path: { name } } }),
      ),
    enabled: Boolean(name),
  });
}
export function useAgentScratchPage(name: string, page: string | null) {
  return useQuery({
    queryKey: agentKeys.scratchPage(name, page),
    queryFn: async () =>
      unwrap<ScratchPage>(
        await client.GET("/api/v1/agents/{name}/scratchpad/{page}", {
          params: { path: { name, page: page! } },
        }),
      ),
    enabled: Boolean(name) && page != null,
  });
}
export function useSaveAgentScratchPage(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { page: string; content: string }) =>
      unwrap<ScratchPage>(
        await client.PUT("/api/v1/agents/{name}/scratchpad/{page}", {
          params: { path: { name, page: vars.page } },
          body: { content: vars.content, tags: [] },
        }),
      ),
    // The page key sits under the list key, so this prefix invalidation already
    // covers the saved page — a second, narrower call would be redundant.
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.scratchpad(name) }),
  });
}
export function useDeleteAgentScratchPage(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (page: string) => {
      unwrap(
        await client.DELETE("/api/v1/agents/{name}/scratchpad/{page}", {
          params: { path: { name, page } },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.scratchpad(name) }),
  });
}
