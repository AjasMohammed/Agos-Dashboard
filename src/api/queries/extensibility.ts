import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import { taskKeys } from "./tasks";
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
  ConnectorDetail,
  PluginDetail,
} from "../models";

// ── Plugins ─────────────────────────────────────────────────────────────────
// `detail` deliberately nests under `all`: enable/disable invalidates the list,
// and an open detail dialog shows the status that just changed.
export const pluginKeys = {
  all: ["plugins"] as const,
  detail: (id: string | null) => ["plugins", id] as const,
};
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
// Nests under `all` for the same reason as `pluginKeys.detail` — a connector
// mutation must refresh the detail dialog it was launched from.
export const connectorKeys = {
  all: ["connectors"] as const,
  detail: (id: string | null) => ["connectors", id] as const,
};
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: EmitEventRequest) =>
      unwrap(await client.POST("/api/v1/events/emit", { body })),
    // A matched subscription spawns tasks; the emit form is the only surface
    // that would otherwise show no sign the event did anything.
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
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

// ── Detail lookups + marketplace review + plugin discover (phase 08) ────────
export function useConnectorDetail(id: string | null) {
  return useQuery({
    queryKey: connectorKeys.detail(id),
    queryFn: async () =>
      unwrap<ConnectorDetail>(
        await client.GET("/api/v1/connectors/{id}", { params: { path: { id: id! } } }),
      ),
    enabled: id != null,
  });
}

export function usePluginDetail(id: string | null) {
  return useQuery({
    queryKey: pluginKeys.detail(id),
    queryFn: async () =>
      unwrap<PluginDetail>(
        await client.GET("/api/v1/plugins/{id}", { params: { path: { id: id! } } }),
      ),
    enabled: id != null,
  });
}

export function useDiscoverPlugins() {
  const qc = useQueryClient();
  return useMutation({
    // Rescans the plugin directories for new manifests.
    mutationFn: async () => unwrap<unknown>(await client.POST("/api/v1/plugins/discover")),
    onSuccess: () => qc.invalidateQueries({ queryKey: pluginKeys.all }),
  });
}

// The literal "detail" segment keeps these lookups out of the marketplace
// *search* key's namespace (`["marketplace", query]`, built at its call site):
// a review invalidating one entry must not cancel the search that is loading.
export const marketplaceKeys = {
  detail: (name: string | null) => ["marketplace", "detail", name] as const,
};

export function useMarketplaceDetail(name: string | null) {
  return useQuery({
    queryKey: marketplaceKeys.detail(name),
    queryFn: async () =>
      unwrap<unknown>(
        await client.GET("/api/v1/marketplace/{name}", { params: { path: { name: name! } } }),
      ) as Record<string, unknown>,
    enabled: name != null,
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; rating: number; comment: string; author_key: string }) =>
      unwrap(
        await client.POST("/api/v1/marketplace/{name}/reviews", {
          params: { path: { name: vars.name } },
          body: { rating: vars.rating, comment: vars.comment, author_key: vars.author_key },
        }),
      ),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: marketplaceKeys.detail(vars.name) }),
  });
}
