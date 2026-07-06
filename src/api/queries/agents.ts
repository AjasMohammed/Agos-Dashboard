import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import { useDisconnectedPolling } from "@/realtime/cacheBridge";
import type {
  AgentDetail,
  AgentIdentity,
  AgentSummary,
  ConnectAgentRequest,
  InboxMessage,
  MemoryItem,
  UpdateAgentSettingsRequest,
} from "../models";

export type MemoryTier = "episodic" | "semantic" | "procedural";

export const agentKeys = {
  all: ["agents"] as const,
  detail: (name: string) => ["agents", name] as const,
};

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
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.all }),
  });
}

export function useDisconnectAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      unwrap(await client.DELETE("/api/v1/agents/{name}", { params: { path: { name } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.all }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.detail(name) }),
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
    onSuccess: (_d, { name }) => qc.invalidateQueries({ queryKey: agentKeys.detail(name) }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.detail(name) }),
  });
}

export function useAgentIdentity(name: string) {
  return useQuery({
    queryKey: [...agentKeys.detail(name), "identity"],
    queryFn: async () =>
      unwrap<AgentIdentity>(
        await client.GET("/api/v1/agents/{name}/identity", { params: { path: { name } } }),
      ),
    enabled: Boolean(name),
  });
}

export function useUpdateAgentSettings(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateAgentSettingsRequest) => {
      unwrap(
        await client.POST("/api/v1/agents/{name}/settings", {
          params: { path: { name } },
          body,
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.detail(name) }),
  });
}

/**
 * Browse or search one memory tier for an agent. Empty `q` → most-recent items;
 * non-empty `q` → tier search. Read-only. `placeholderData` keeps the prior list
 * visible while the tier switches or the query is debounced by typing.
 */
export function useAgentMemory(agentId: string, tier: MemoryTier, q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: [...agentKeys.detail(agentId), "memory", tier, trimmed],
    queryFn: async () =>
      unwrap<MemoryItem[]>(
        await client.GET("/api/v1/agents/{id}/memory/{tier}", {
          params: {
            path: { id: agentId, tier },
            query: trimmed ? { q: trimmed } : {},
          },
        }),
      ),
    enabled: Boolean(agentId),
    placeholderData: (prev) => prev,
  });
}

/** Agent-to-agent message timeline (read-only). Newest window, oldest-first. */
export function useAgentInbox(agentId: string, limit = 100) {
  return useQuery({
    queryKey: [...agentKeys.detail(agentId), "inbox", limit],
    queryFn: async () =>
      unwrap<InboxMessage[]>(
        await client.GET("/api/v1/agents/{id}/inbox", {
          params: { path: { id: agentId }, query: { limit } },
        }),
      ),
    enabled: Boolean(agentId),
  });
}
