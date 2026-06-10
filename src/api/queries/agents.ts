import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import type {
  AgentDetail,
  AgentIdentity,
  AgentSummary,
  ConnectAgentRequest,
  UpdateAgentSettingsRequest,
} from "../models";

export const agentKeys = {
  all: ["agents"] as const,
  detail: (name: string) => ["agents", name] as const,
};

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.all,
    queryFn: async () => unwrap<AgentSummary[]>(await client.GET("/api/v1/agents")),
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
