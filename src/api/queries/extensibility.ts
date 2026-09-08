import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import { taskKeys } from "./tasks";
import { toolKeys } from "./tools";
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
  AttachMcpRequest,
  McpAttached,
  McpCatalogEntry,
  ConnectChannelRequest,
  UpdateChannelRequest,
  Pairings,
  StoreCredentialRequest,
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
// Siblings for the same reason as `mcpKeys`: approving a pairing must not
// cancel the channel list load, and vice versa.
export const channelKeys = {
  list: ["channels", "list"] as const,
  pairings: ["channels", "pairings"] as const,
};
export function useChannels() {
  return useQuery({
    queryKey: channelKeys.list,
    queryFn: async () => unwrap<ChannelSummary[]>(await client.GET("/api/v1/channels")),
  });
}
export function useDisconnectChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.POST("/api/v1/channels/{id}/disconnect", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.list }),
  });
}

/** Register a channel. An inline `credential` is stored in the vault by the kernel. */
export function useConnectChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ConnectChannelRequest) =>
      unwrap<ChannelSummary>(await client.POST("/api/v1/channels", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.list }),
  });
}

/** Deliver a test notification — the only way to prove a channel really works. */
/** Edit a connected channel in place; the kernel rebuilds its adapter. */
export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; body: UpdateChannelRequest }) =>
      unwrap<ChannelSummary>(
        await client.PUT("/api/v1/channels/{id}", {
          params: { path: { id: vars.id } },
          body: vars.body,
        }),
      ),
    // The adapter is torn down before the rebuild, so health can change even on
    // a failed edit.
    onSettled: () => qc.invalidateQueries({ queryKey: channelKeys.list }),
  });
}
export function useTestChannel() {
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.POST("/api/v1/channels/{id}/test", { params: { path: { id } } }));
    },
  });
}

export function useSetChannelAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; agent_name: string | null }) => {
      unwrap(
        await client.PUT("/api/v1/channels/{id}/agent", {
          params: { path: { id: vars.id } },
          // `null` clears the default; the API treats absent and empty the same.
          body: { agent_name: vars.agent_name ?? undefined },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.list }),
  });
}

export function usePairings(enabled = true) {
  return useQuery({
    queryKey: channelKeys.pairings,
    queryFn: async () => unwrap<Pairings>(await client.GET("/api/v1/channels/pairings")),
    enabled,
    // Pairing requests arrive out of band (a stranger DMs the bot) and the
    // pending entry lives 10 minutes. With the panel's `refetchOnWindowFocus:
    // false`, an already-open tab would show a stale empty list for the whole
    // window and the operator would never see the row to approve.
    refetchInterval: 10_000,
  });
}

export function useApprovePairing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      unwrap(
        await client.POST("/api/v1/channels/pairings/{code}/approve", {
          params: { path: { code } },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.pairings }),
  });
}

/**
 * Approve a pending request by the `(channel, sender)` pair the pending list
 * already exposes. The code-based sibling stays for pairing someone who is not
 * you and had to be told the code out of band; this is the only route when the
 * operator *is* the sender, since the code never leaves the kernel log.
 */
export function useApprovePendingPairing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { channel_id: string; sender_id: string }) => {
      unwrap(
        await client.POST("/api/v1/channels/{id}/pairings/{sender_id}/approve", {
          params: { path: { id: vars.channel_id, sender_id: vars.sender_id } },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.pairings }),
  });
}

export function useRevokePairing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { channel_id: string; sender_id: string }) => {
      unwrap(
        await client.DELETE("/api/v1/channels/{id}/pairings/{sender_id}", {
          params: { path: { id: vars.channel_id, sender_id: vars.sender_id } },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.pairings }),
  });
}

// ── MCP servers ─────────────────────────────────────────────────────────────
// `servers` and `catalog` are siblings, not parent/child: installing from the
// catalog invalidates the server list, and a bare ["mcp"] parent would cancel
// the catalog fetch that the install dialog is still showing.
export const mcpKeys = {
  servers: ["mcp", "servers"] as const,
  /** Every catalog search at once — what an install/detach has to refresh. */
  catalogAll: ["mcp", "catalog"] as const,
  catalog: (q: string) => ["mcp", "catalog", q] as const,
};
export function useMcpServers() {
  return useQuery({
    queryKey: mcpKeys.servers,
    queryFn: async () => unwrap<McpServer[]>(await client.GET("/api/v1/mcp")),
  });
}
export function useDetachMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      unwrap(await client.POST("/api/v1/mcp/{name}/detach", { params: { path: { name } } }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mcpKeys.servers });
      // The catalog rows carry an `installed` flag that just changed.
      void qc.invalidateQueries({ queryKey: mcpKeys.catalogAll });
      // Its tools leave every agent's toolbox.
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

/** Attach a tool server at runtime — stdio (`command`) or http (`url`). */
export function useAttachMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AttachMcpRequest) =>
      unwrap<McpAttached>(await client.POST("/api/v1/mcp", { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mcpKeys.servers });
      void qc.invalidateQueries({ queryKey: mcpKeys.catalogAll });
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

/** Re-attach a server under the same name with an edited configuration. */
export function useUpdateMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; body: AttachMcpRequest }) =>
      unwrap<McpAttached>(
        await client.PUT("/api/v1/mcp/{name}", {
          params: { path: { name: vars.name } },
          body: vars.body,
        }),
      ),
    // An edit detaches before it re-attaches, so a *failed* edit still changed
    // the world — `onSuccess` would leave the list showing a server and a tool
    // count that no longer exist.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: mcpKeys.servers });
      void qc.invalidateQueries({ queryKey: mcpKeys.catalogAll });
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

/** Curated catalog of installable servers (`q` filters server-side). */
export function useMcpCatalog(q: string) {
  return useQuery({
    queryKey: mcpKeys.catalog(q),
    // `signal`: a superseded search is cancelled, not run to completion.
    queryFn: async ({ signal }) =>
      unwrap<McpCatalogEntry[]>(
        await client.GET("/api/v1/mcp/catalog", { params: { query: q ? { q } : {} }, signal }),
      ),
  });
}

export function useInstallMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; allow_community?: boolean; no_auth?: boolean }) =>
      unwrap<McpAttached>(
        await client.POST("/api/v1/mcp/catalog/{id}/install", {
          params: { path: { id: vars.id } },
          body: {
            allow_community: vars.allow_community ?? false,
            no_auth: vars.no_auth ?? false,
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mcpKeys.servers });
      void qc.invalidateQueries({ queryKey: mcpKeys.catalogAll });
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

// ── Connectors ──────────────────────────────────────────────────────────────
// Nests under `all` for the same reason as `pluginKeys.detail` — a connector
// mutation must refresh the detail dialog it was launched from.
export const connectorKeys = {
  all: ["connectors"] as const,
  detail: (id: string | null) => ["connectors", id] as const,
};
export function useConnectors(enabled = true) {
  return useQuery({
    queryKey: connectorKeys.all,
    queryFn: async () => unwrap<ConnectorSummary[]>(await client.GET("/api/v1/connectors")),
    enabled,
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

/** Install from a pasted `plugin.toml`. An unsigned community manifest lands `blocked`. */
export function useInstallPlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (manifest_toml: string) =>
      unwrap<PluginSummary>(
        await client.POST("/api/v1/plugins", { body: { manifest_toml } }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: pluginKeys.all }),
  });
}

/** Only user-installed plugins can be removed; the API refuses the bundled ones. */
export function useRemovePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/plugins/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
      // An active plugin's tools are unregistered as part of removal.
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

/** Replace a user plugin's manifest in place, keeping it enabled if it was. */
export function useUpdatePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; manifest_toml: string }) =>
      unwrap<PluginSummary>(
        await client.PUT("/api/v1/plugins/{id}", {
          params: { path: { id: vars.id } },
          body: { manifest_toml: vars.manifest_toml },
        }),
      ),
    // Removes the registry entry before rediscovering it.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
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

/** Register a connector from a pasted manifest TOML. */
export function useAddConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (manifest_toml: string) =>
      unwrap<ConnectorDetail>(
        await client.POST("/api/v1/connectors", { body: { manifest_toml } }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectorKeys.all });
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

/** Replace a connector manifest in place, keeping its stored credential. */
export function useUpdateConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; manifest_toml: string }) =>
      unwrap<ConnectorDetail>(
        await client.PUT("/api/v1/connectors/{id}", {
          params: { path: { id: vars.id } },
          body: { manifest_toml: vars.manifest_toml },
        }),
      ),
    // Replaces the registration — a failure can still leave it changed.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: connectorKeys.all });
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

/** Drops the manifest *and* the stored credential — unlike disconnect. */
export function useRemoveConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/connectors/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectorKeys.all });
      void qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

/**
 * Begin OAuth. Returns the provider URL to send the operator to; the provider
 * redirects back to the API's callback, which bounces here with `?oauth=…`.
 */
export function useStartConnectorOAuth() {
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap<{ authorize_url: string }>(
        await client.POST("/api/v1/connectors/{id}/oauth/start", { params: { path: { id } } }),
      ),
  });
}

/** Paste a token obtained elsewhere (the CLI's `mcp oauth-store` equivalent). */
export function useStoreConnectorCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; body: StoreCredentialRequest }) => {
      unwrap(
        await client.POST("/api/v1/connectors/{id}/credential", {
          params: { path: { id: vars.id } },
          body: vars.body,
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: connectorKeys.all }),
  });
}

// The literal "detail" segment keeps these lookups out of the marketplace
// *search* key's namespace (`["marketplace", query]`, built at its call site):
// a review invalidating one entry must not cancel the search that is loading.
export const marketplaceKeys = {
  detail: (name: string | null) => ["marketplace", "detail", name] as const,
  search: (q: string) => ["marketplace", "search", q] as const,
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
