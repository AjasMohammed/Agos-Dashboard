import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import type {
  PluginSummary,
  ChannelSummary,
  McpServer,
  ConnectorSummary,
  WebhookEndpoint,
  EventSubscription,
  CreateSubscriptionRequest,
  EmitEventRequest,
  SkillSummary,
  SkillDetail,
} from "../models";

// ── Plugins ─────────────────────────────────────────────────────────────────
export const pluginKeys = { all: ["plugins"] as const };
export function usePlugins() {
  return useQuery({
    queryKey: pluginKeys.all,
    queryFn: async () => unwrap<PluginSummary[]>(await client.GET("/api/v1/plugins")),
  });
}
export function useTogglePlugin(action: "enable" | "disable") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const path = `/api/v1/plugins/{id}/${action}` as
        | "/api/v1/plugins/{id}/enable"
        | "/api/v1/plugins/{id}/disable";
      unwrap(await client.POST(path, { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pluginKeys.all }),
  });
}

// ── Channels ────────────────────────────────────────────────────────────────
export const channelKeys = { all: ["channels"] as const };
export function useChannels() {
  return useQuery({
    queryKey: channelKeys.all,
    queryFn: async () => unwrap<ChannelSummary[]>(await client.GET("/api/v1/channels")),
  });
}
export function useDisconnectChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.POST("/api/v1/channels/{id}/disconnect", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

// ── MCP servers ─────────────────────────────────────────────────────────────
export const mcpKeys = { all: ["mcp"] as const };
export function useMcpServers() {
  return useQuery({
    queryKey: mcpKeys.all,
    queryFn: async () => unwrap<McpServer[]>(await client.GET("/api/v1/mcp")),
  });
}
export function useDetachMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      unwrap(await client.POST("/api/v1/mcp/{name}/detach", { params: { path: { name } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: mcpKeys.all }),
  });
}

// ── Connectors ──────────────────────────────────────────────────────────────
export const connectorKeys = { all: ["connectors"] as const };
export function useConnectors() {
  return useQuery({
    queryKey: connectorKeys.all,
    queryFn: async () => unwrap<ConnectorSummary[]>(await client.GET("/api/v1/connectors")),
  });
}
export function useDisconnectConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.POST("/api/v1/connectors/{id}/disconnect", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: connectorKeys.all }),
  });
}

// ── Webhooks ────────────────────────────────────────────────────────────────
export const webhookKeys = { all: ["webhooks"] as const };
export function useWebhooks() {
  return useQuery({
    queryKey: webhookKeys.all,
    queryFn: async () => unwrap<WebhookEndpoint[]>(await client.GET("/api/v1/webhooks")),
  });
}
export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { agent_name: string; provider: string; debounce_seconds?: number }) =>
      unwrap<{ secret?: string; inbound_url?: string }>(
        await client.POST("/api/v1/webhooks", { body }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhookKeys.all }),
  });
}
export function useRotateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap<{ secret?: string; inbound_url?: string }>(
        await client.POST("/api/v1/webhooks/{id}/rotate", { params: { path: { id } } }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhookKeys.all }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/webhooks/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: webhookKeys.all }),
  });
}

// ── Event subscriptions ─────────────────────────────────────────────────────
export const eventKeys = { all: ["events", "subscriptions"] as const };
export function useEventSubscriptions() {
  return useQuery({
    queryKey: eventKeys.all,
    queryFn: async () =>
      unwrap<EventSubscription[]>(await client.GET("/api/v1/events/subscriptions")),
  });
}
export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateSubscriptionRequest) =>
      unwrap<EventSubscription>(
        await client.POST("/api/v1/events/subscriptions", { body }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
  });
}
export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(
        await client.DELETE("/api/v1/events/subscriptions/{id}", { params: { path: { id } } }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
  });
}
export function useToggleSubscription(action: "enable" | "disable") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const path = `/api/v1/events/subscriptions/{id}/${action}` as
        | "/api/v1/events/subscriptions/{id}/enable"
        | "/api/v1/events/subscriptions/{id}/disable";
      unwrap(await client.POST(path, { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
  });
}
export function useEmitEvent() {
  return useMutation({
    mutationFn: async (body: EmitEventRequest) =>
      unwrap(await client.POST("/api/v1/events/emit", { body })),
  });
}

// ── Skills (read-only library) ────────────────────────────────────────────────
export const skillKeys = {
  all: ["skills"] as const,
  detail: (name: string) => ["skills", name] as const,
};
export function useSkills() {
  return useQuery({
    queryKey: skillKeys.all,
    queryFn: async () => unwrap<SkillSummary[]>(await client.GET("/api/v1/skills")),
  });
}
export function useSkill(name: string, enabled: boolean) {
  return useQuery({
    queryKey: skillKeys.detail(name),
    queryFn: async () =>
      unwrap<SkillDetail>(
        await client.GET("/api/v1/skills/{name}", { params: { path: { name } } }),
      ),
    enabled: enabled && Boolean(name),
  });
}
