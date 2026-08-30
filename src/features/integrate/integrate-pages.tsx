import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Puzzle, Radio, Plug, Link2, Webhook, Activity, Store, Sparkles, Copy } from "lucide-react";
import { client, unwrap } from "@/api/client";
import {
  usePlugins,
  useTogglePlugin,
  useChannels,
  useDisconnectChannel,
  useMcpServers,
  useDetachMcp,
  useConnectors,
  useDisconnectConnector,
  useWebhooks,
  useCreateWebhook,
  useRotateWebhook,
  useDeleteWebhook,
  useEventSubscriptions,
  useCreateSubscription,
  useDeleteSubscription,
  useToggleSubscription,
  useEmitEvent,
  useSkills,
  useSkill,
  usePluginDetail,
  useDiscoverPlugins,
  useConnectorDetail,
  useMarketplaceDetail,
  useSubmitReview,
} from "@/api/queries/extensibility";
import { useAgents, useAgent, useGrantAgentPermission } from "@/api/queries/agents";
import {
  EVENT_CATALOG,
  requiredResourcesFor,
  humanizeEvent,
  fieldsForSelection,
  isExactSelection,
  prettifyFilter,
  prettifyThrottle,
  validateFilter,
  payloadSkeleton,
  NEVER_EMITTED,
} from "./event-catalog";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import type {
  PluginSummary,
  ChannelSummary,
  McpServer,
  ConnectorSummary,
  WebhookEndpoint,
  EventSubscription,
} from "@/api/models";

export function PluginsPage() {
  const query = usePlugins();
  const enable = useTogglePlugin("enable");
  const disable = useTogglePlugin("disable");
  const [detailId, setDetailId] = useState<string | null>(null);

  // Disabling takes the plugin's channels and tools offline for every agent —
  // too broad a blast radius for an unguarded click.
  async function onDisable(p: PluginSummary) {
    const ok = await confirm({
      title: `Disable ${p.display_name}?`,
      description: "Its channels and tools go offline for every agent until it is re-enabled.",
      destructive: true,
      confirmLabel: "Disable",
    });
    if (!ok) return;
    disable.mutateAsync(p.id).catch(toastError);
  }

  const columns: Column<PluginSummary>[] = [
    {
      key: "name",
      header: "Name",
      cell: (p) => (
        <button className="font-medium hover:underline" onClick={() => setDetailId(p.id)}>
          {p.display_name}
        </button>
      ),
    },
    { key: "version", header: "Version", cell: (p) => <span className="text-muted-foreground">{p.version}</span> },
    { key: "trust", header: "Trust", cell: (p) => <Badge variant="outline">{p.trust_tier}</Badge> },
    { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
    {
      key: "actions",
      header: "",
      cell: (p) =>
        p.status === "active" ? (
          <Button variant="ghost" size="sm" onClick={() => onDisable(p)}>
            Disable
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => enable.mutateAsync(p.id).catch(toastError)}>
            Enable
          </Button>
        ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Plugins"
        description="Installed plugin manifests."
        actions={<DiscoverPluginsButton />}
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={Puzzle}
            title="No plugins"
            description="Plugins are discovered from the plugins/user/ directory next to the data dir — drop a manifest there and rescan. Enable with `agentos plugin enable <id>`; see `agentos plugin --help`."
            action={<DiscoverPluginsButton />}
          />
        }
      >
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(p) => p.id} />}
      </QueryState>
      <PluginDetailDialog id={detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </div>
  );
}

export function ChannelsPage() {
  const query = useChannels();
  const disconnect = useDisconnectChannel();
  // Name the channel: the operator may have several of the same kind.
  async function onDisconnect(c: ChannelSummary) {
    const ok = await confirm({
      title: `Disconnect ${c.display_name}?`,
      description: `Agents can no longer reach you over this ${c.kind} channel.`,
      destructive: true,
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    disconnect.mutateAsync(c.id).then(() => toast.success("Disconnected")).catch(toastError);
  }
  const columns: Column<ChannelSummary>[] = [
    { key: "kind", header: "Kind", cell: (c) => <Badge variant="muted">{c.kind}</Badge> },
    { key: "name", header: "Name", cell: (c) => <span className="font-medium">{c.display_name}</span> },
    { key: "health", header: "Health", cell: (c) => <StatusBadge status={c.health ?? "unknown"} /> },
    { key: "active", header: "Last active", cell: (c) => <span className="text-muted-foreground">{relativeTime(c.last_active)}</span> },
    { key: "actions", header: "", cell: (c) => <Button variant="ghost" size="sm" onClick={() => onDisconnect(c)}>Disconnect</Button> },
  ];
  return (
    <div>
      <PageHeader title="Channels" description="Where your assistants can reach you — Slack, Telegram, and friends." />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={Radio}
            title="No channels"
            description="Connect one from the CLI: `agentos channel connect --kind telegram --display-name <name>` (kinds: telegram, ntfy, email). See `agentos channel --help`."
          />
        }
      >
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(c) => c.id} />}
      </QueryState>
    </div>
  );
}

export function McpPage() {
  const query = useMcpServers();
  const detach = useDetachMcp();

  // Detaching pulls a whole tool server out from under running tasks.
  async function onDetach(m: McpServer) {
    const ok = await confirm({
      title: `Detach ${m.name}?`,
      description: "Its tools disappear from every agent; tasks calling them mid-run will fail.",
      destructive: true,
      confirmLabel: "Detach",
    });
    if (!ok) return;
    detach.mutateAsync(m.name).then(() => toast.success("Detached")).catch(toastError);
  }

  const columns: Column<McpServer>[] = [
    { key: "name", header: "Name", cell: (m) => <span className="font-medium">{m.name}</span> },
    { key: "command", header: "Command", cell: (m) => <code className="text-xs text-muted-foreground">{m.command}</code> },
    { key: "state", header: "State", cell: (m) => <StatusBadge status={m.state ?? "unknown"} /> },
    { key: "actions", header: "", cell: (m) => <Button variant="ghost" size="sm" onClick={() => onDetach(m)}>Detach</Button> },
  ];
  return (
    <div>
      <PageHeader title="Tool servers (MCP)" description="External tool servers your assistants can call." />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={Plug}
            title="No tool servers"
            description="Attach one from the CLI: `agentos mcp attach <name> -- <command…>` for a local server, or `agentos mcp attach <name> --url <endpoint>` for HTTP. See `agentos mcp --help`."
          />
        }
      >
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(m) => m.name} />}
      </QueryState>
    </div>
  );
}

export function ConnectorsPage() {
  const query = useConnectors();
  const disconnect = useDisconnectConnector();
  const [detailId, setDetailId] = useState<string | null>(null);

  // Disconnecting drops the stored OAuth token — reconnecting means a full
  // re-authorization with the provider.
  async function onDisconnect(c: ConnectorSummary) {
    const ok = await confirm({
      title: `Disconnect ${c.name}?`,
      description: `The stored ${c.provider} token is dropped; agents lose access until you reconnect.`,
      destructive: true,
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    disconnect.mutateAsync(c.id).then(() => toast.success("Disconnected")).catch(toastError);
  }

  const columns: Column<ConnectorSummary>[] = [
    {
      key: "name",
      header: "Name",
      cell: (c) => (
        <button className="font-medium hover:underline" onClick={() => setDetailId(c.id)}>
          {c.name}
        </button>
      ),
    },
    { key: "provider", header: "Provider", cell: (c) => c.provider },
    { key: "connected", header: "Status", cell: (c) => <StatusBadge status={c.connected ? "connected" : "offline"} /> },
    { key: "scopes", header: "Scopes", cell: (c) => <span className="text-xs text-muted-foreground">{(c.scopes ?? []).join(", ") || "—"}</span> },
    { key: "actions", header: "", cell: (c) => <Button variant="ghost" size="sm" onClick={() => onDisconnect(c)}>Disconnect</Button> },
  ];
  return (
    <div>
      <PageHeader title="Connectors" description="OAuth connectors for external services." />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={Link2}
            title="No connectors"
            description="Connectors load from connectors/*.toml in the data dir. Store the OAuth credential with `agentos mcp oauth-store <id> --access-token … --token-endpoint …`, then attach with `agentos mcp attach <name> --oauth-connector <id>`."
          />
        }
      >
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(c) => c.id} />}
      </QueryState>
      <ConnectorDetailDialog id={detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </div>
  );
}

function copyText(text: string, label: string) {
  // navigator.clipboard is absent in insecure (plain-http, non-localhost) contexts.
  if (!navigator.clipboard) {
    toast.error("Copy failed (clipboard unavailable)");
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Copy failed"),
  );
}

/** What create/rotate hand back — the signing secret is in here exactly once. */
type WebhookIssued = { secret?: string; inbound_url?: string };

/**
 * Shown-once panel for a webhook's HMAC signing secret. The API returns it a
 * single time and stores only its hash: if it is lost (a 4s toast, a stray ESC)
 * the sender's signature verification can never be configured again — the only
 * recovery is another rotation. Same contract as `CreateKeyDialog` in
 * system-pages; the caller must also block dismissal while this is on screen.
 */
function WebhookSecretPanel({
  title,
  issued,
  onDone,
}: {
  title: string;
  issued: WebhookIssued;
  onDone: () => void;
}) {
  const { secret, inbound_url: url } = issued;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {/* `secret` and `inbound_url` are required on WebhookSecretResponse, so
          create and rotate always carry both; the render guards below are only
          TS narrowing of the client's optional type. */}
      <DialogDescription>
        This is the only time the signing secret is shown — copy it into the sender now.
      </DialogDescription>
      <div className="grid gap-2">
        {url && (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-2 text-xs">{url}</code>
            <Button size="sm" variant="outline" onClick={() => copyText(url, "Inbound URL")}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
        )}
        {secret && (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-2 text-xs">{secret}</code>
            <Button size="sm" onClick={() => copyText(secret, "Signing secret")}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

/** The exact set `POST /api/v1/webhooks` accepts (anything else is a 400). */
const WEBHOOK_PROVIDERS: Array<{ id: string; hint: string }> = [
  { id: "generic", hint: "HMAC-SHA256 of the body in the X-Signature header." },
  { id: "github", hint: "GitHub signs with X-Hub-Signature-256." },
  { id: "stripe", hint: "Stripe signs with Stripe-Signature (t=…,v1=…)." },
  { id: "slack", hint: "Verified like generic: HMAC-SHA256 in X-Signature." },
  { id: "pagerduty", hint: "PagerDuty signs with X-PagerDuty-Signature (v1=…)." },
];

function CreateWebhookDialog() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("generic");
  const [agent, setAgent] = useState("");
  // Held until the operator dismisses it — see WebhookSecretPanel.
  const [issued, setIssued] = useState<WebhookIssued | null>(null);
  const agents = useAgents();
  const create = useCreateWebhook();

  function reset() {
    setProvider("generic");
    setAgent("");
    setIssued(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // No silent fallback to "the first agent in the list": the table can't show
    // which agent an endpoint targets, so a wrong pick is undiagnosable.
    if (!agent) {
      toast.error("Select a target agent");
      return;
    }
    try {
      // Always a shown-once secret to reveal — the response carries it by contract.
      setIssued(await create.mutateAsync({ agent_name: agent, provider }));
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // While the shown-once secret is up, only "Done" closes — the X would
        // otherwise wipe a value that cannot be re-fetched.
        if (!o && issued) return;
        setOpen(o);
        if (!o) reset(); // reset on close, not only on success
      }}
    >
      <DialogTrigger asChild>
        <Button>New webhook</Button>
      </DialogTrigger>
      <DialogContent
        onEscapeKeyDown={(e) => issued && e.preventDefault()}
        onPointerDownOutside={(e) => issued && e.preventDefault()}
        onInteractOutside={(e) => issued && e.preventDefault()}
      >
        {issued ? (
          <WebhookSecretPanel
            title="Webhook created — copy the secret now"
            issued={issued}
            onDone={() => {
              setIssued(null);
              setOpen(false);
              reset();
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create webhook</DialogTitle>
              <DialogDescription>
                Pick the sender's provider so inbound signatures verify, and the agent that handles deliveries.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Provider</span>
                <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {WEBHOOK_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.id}</option>
                  ))}
                </Select>
                <span className="text-xs text-muted-foreground">
                  {WEBHOOK_PROVIDERS.find((p) => p.id === provider)?.hint}
                </span>
              </label>
              <Select required value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="">{agents.data?.length ? "Target agent…" : "No agents"}</option>
                {(agents.data ?? []).map((a) => (
                  <option key={a.id} value={a.name}>{a.name}</option>
                ))}
              </Select>
              <DialogFooter>
                <Button type="submit" disabled={create.isPending || !agent}>Create</Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WebhooksPage() {
  const query = useWebhooks();
  const agents = useAgents();
  const del = useDeleteWebhook();
  const rotate = useRotateWebhook();
  // The rotated secret is returned once; hold it in a dialog the operator has
  // to dismiss rather than a toast that expires in ~4s.
  const [rotated, setRotated] = useState<WebhookIssued | null>(null);
  // Per-row in-flight set (same pattern as KeysPage): the shared
  // `rotate.isPending` disabled Rotate on every row while one call was in
  // flight, so a hung request froze the whole list.
  const [rotating, setRotating] = useState<ReadonlySet<string>>(new Set());

  // Endpoints look alike in the list — name the one being deleted.
  async function onDelete(w: WebhookEndpoint) {
    const ok = await confirm({
      title: `Delete the ${w.provider} webhook?`,
      description: w.inbound_url,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    del.mutateAsync(String(w.id)).then(() => toast.success("Deleted")).catch(toastError);
  }

  // Rotating invalidates the sender's HMAC config the moment it lands: every
  // inbound delivery fails signature verification until the remote provider is
  // reconfigured. It sits next to Delete, so confirm it like Delete.
  async function onRotate(w: WebhookEndpoint) {
    const ok = await confirm({
      title: `Rotate the ${w.provider} webhook secret?`,
      description: `Deliveries to ${w.inbound_url} will fail signature verification until the sender is updated with the new secret.`,
      destructive: true,
      confirmLabel: "Rotate",
    });
    if (!ok) return;
    const id = String(w.id);
    setRotating((prev) => new Set(prev).add(id));
    try {
      setRotated(await rotate.mutateAsync(id));
    } catch (err) {
      toastError(err);
    } finally {
      setRotating((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Webhooks store the target agent as a UUID; show the name so a mis-targeted
  // endpoint is visible after the fact.
  const agentNameById = useMemo(
    () => new Map((agents.data ?? []).map((a) => [a.id, a.name])),
    [agents.data],
  );

  const columns: Column<WebhookEndpoint>[] = [
    { key: "provider", header: "Provider", cell: (w) => <Badge variant="muted">{w.provider}</Badge> },
    {
      key: "agent",
      header: "Agent",
      cell: (w) => (
        <span className="font-medium">{agentNameById.get(w.agent_id) ?? w.agent_id ?? "—"}</span>
      ),
    },
    { key: "url", header: "Inbound URL", cell: (w) => <code className="text-xs text-muted-foreground line-clamp-1">{w.inbound_url}</code> },
    { key: "active", header: "Status", cell: (w) => <StatusBadge status={w.active ? "active" : "paused"} /> },
    { key: "count", header: "Received", cell: (w) => <span className="text-muted-foreground">{w.total_received}</span> },
    {
      key: "actions",
      header: "",
      cell: (w) => (
        <span className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={rotating.has(String(w.id))} onClick={() => void onRotate(w)}>Rotate</Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(w)}>Delete</Button>
        </span>
      ),
    },
  ];
  return (
    <div>
      <PageHeader title="Webhooks" description="Inbound webhook endpoints." actions={<CreateWebhookDialog />} />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Webhook} title="No webhooks" action={<CreateWebhookDialog />} />}>
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(w) => String(w.id)} />}
      </QueryState>
      <Dialog
        open={rotated != null}
        // Only "Done" may close: ESC / outside-click / X would discard the new
        // secret and the sender's HMAC check would stay broken.
        onOpenChange={() => undefined}
      >
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {rotated && (
            <WebhookSecretPanel
              title="Secret rotated — copy it now"
              issued={rotated}
              onDone={() => setRotated(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Friendly label for a subscription's required permission resource. */
function resourceLabel(resource: string): string {
  return EVENT_CATALOG.find((c) => c.resource === resource)?.label ?? resource;
}

/**
 * Inline, real-time notice about whether the chosen agent can already observe
 * the selected events, with an opt-in to grant the missing access.
 *
 * Note on semantics: subscribing via this operator form is a *bypass* — the
 * agent gets triggered whether or not it holds the event permission, and the
 * subscription itself grants nothing. Granting `events.<category>:o` is a
 * separate, explicit action offered here so the agent can also see/manage the
 * subscription itself and act coherently on the events.
 */
function PermissionNotice({
  agentName,
  loading,
  missing,
  grant,
  onGrantChange,
}: {
  agentName: string;
  loading: boolean;
  missing: string[];
  grant: boolean;
  onGrantChange: (v: boolean) => void;
}) {
  if (!agentName) return null;
  if (loading) {
    return <p className="text-xs text-muted-foreground">Checking {agentName}’s access…</p>;
  }

  if (missing.length === 0) {
    return (
      <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
        ✓ {agentName} can already observe these events.
      </p>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
      <p>
        {agentName} doesn’t have observe access to{" "}
        <span className="font-medium">{missing.map(resourceLabel).join(", ")}</span>. The
        subscription will still trigger {agentName} (operator override), but it won’t be able to see
        or manage this subscription itself.
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={grant}
          onChange={(e) => onGrantChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Also grant {agentName}:{" "}
          <code>{missing.map((r) => `${r}:o`).join(", ")}</code>
        </span>
      </label>
    </div>
  );
}

/** Dialog to assign an event (subscription) to an agent so it gets triggered. */
function SubscribeAgentDialog() {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState("");
  // `selection` is the API `event_filter` directly: "all", "category:<Name>", or a bare event type.
  const [selection, setSelection] = useState("category:TaskLifecycle");
  const [priority, setPriority] = useState("normal");
  const [payloadFilter, setPayloadFilter] = useState("");
  const [throttle, setThrottle] = useState("");
  const [grant, setGrant] = useState(true);
  const agents = useAgents();
  const detail = useAgent(agent);
  const create = useCreateSubscription();
  const grantPermission = useGrantAgentPermission();

  // What observe-access the selection needs vs. what the agent already holds.
  const held = useMemo(() => new Set(detail.data?.permissions ?? []), [detail.data]);
  const missing = useMemo(
    () => (agent ? requiredResourcesFor(selection).filter((r) => !held.has(r)) : []),
    [agent, selection, held],
  );
  const suggestedFields = useMemo(() => fieldsForSelection(selection), [selection]);
  const filterError = useMemo(() => validateFilter(payloadFilter), [payloadFilter]);

  /** Append a payload field name into the filter input so the user can finish the predicate. */
  function insertField(field: string) {
    setPayloadFilter((prev) => (prev.trimEnd() ? `${prev.trimEnd()} ${field} ` : `${field} `));
  }

  function resetForm() {
    setAgent("");
    setSelection("category:TaskLifecycle");
    setPriority("normal");
    setPayloadFilter("");
    setThrottle("");
    setGrant(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agent) {
      toast.error("Select an agent");
      return;
    }
    if (filterError) {
      toast.error(filterError);
      return;
    }
    try {
      // Optionally grant the missing observe access first, so the agent can
      // manage/act on the subscription. Best-effort per resource; a failed
      // grant still lets the subscription be created (operator override) — but
      // it must be *reported*: a session key without `agents:w` 403s on every
      // grant, and a plain "Subscription created" would leave the operator
      // believing the agent can observe events it still cannot see.
      let failedGrants = 0;
      if (grant && missing.length > 0) {
        const results = await Promise.allSettled(
          missing.map((r) => grantPermission.mutateAsync({ name: agent, permission: `${r}:o` })),
        );
        failedGrants = results.filter((r) => r.status === "rejected").length;
      }
      await create.mutateAsync({
        agent_name: agent,
        event_filter: selection,
        priority,
        payload_filter: payloadFilter.trim() || null,
        throttle: throttle.trim() || null,
      });
      if (failedGrants > 0) {
        toast.warning(
          `Subscription created, but ${failedGrants} of ${missing.length} permission grants failed — ${agent} will be triggered without observe access.`,
        );
      } else {
        toast.success("Subscription created");
      }
      setOpen(false); // onOpenChange resets the form
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={open}
      // Reset on close, not only on success: a half-filled form left by an ESC
      // must not reappear pointed at a different agent, one click from creating
      // the wrong subscription and granting the wrong agent observe access.
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>Subscribe agent</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribe an agent to events</DialogTitle>
          <DialogDescription className="sr-only">
            Choose an agent and the events that should trigger it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Agent</span>
            <Select
              value={agent}
              onChange={(e) => {
                setAgent(e.target.value);
                setGrant(true); // fresh agent → default back to granting missing access
              }}
            >
              <option value="">{agents.data?.length ? "Select agent…" : "No agents"}</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.name}>{a.name}</option>
              ))}
            </Select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Trigger this agent when…</span>
            <Select value={selection} onChange={(e) => setSelection(e.target.value)}>
              <option value="all">Anything happens (all events)</option>
              {EVENT_CATALOG.map((c) => (
                <optgroup key={c.value} label={c.label}>
                  <option value={`category:${c.value}`}>Any {c.label.toLowerCase()} event</option>
                  {c.events.map((ev) => (
                    <option key={ev} value={ev}>
                      {humanizeEvent(ev)}
                      {NEVER_EMITTED.has(ev) ? " (not currently emitted)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>

          <div aria-live="polite">
            <PermissionNotice
              agentName={agent}
              loading={detail.isLoading}
              missing={missing}
              grant={grant}
              onGrantChange={setGrant}
            />
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Priority</span>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </Select>
          </label>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Advanced options</summary>
            <div className="mt-2 grid gap-3">
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Payload filter — only trigger when the event data matches
                </span>
                <Input
                  value={payloadFilter}
                  onChange={(e) => setPayloadFilter(e.target.value)}
                  placeholder="e.g. tool_name == shell"
                  aria-invalid={filterError ? true : undefined}
                  className={filterError ? "border-destructive" : undefined}
                />
                {filterError && <span className="text-[11px] text-destructive">{filterError}</span>}
                {suggestedFields.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs text-muted-foreground">Fields:</span>
                    {suggestedFields.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => insertField(f)}
                        className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                ) : (
                  isExactSelection(selection) && (
                    <span className="text-[11px] text-muted-foreground">
                      This event carries no simple fields to filter on.
                    </span>
                  )
                )}
                {!isExactSelection(selection) && suggestedFields.length === 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    Pick a specific event above to see the fields you can filter on.
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  Operators: <code>== != &gt; &gt;= &lt; &lt;= in contains</code> · combine with{" "}
                  <code>and</code>
                </span>
              </div>

              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Throttle — limit how often this can trigger the agent
                </span>
                <Input
                  value={throttle}
                  onChange={(e) => setThrottle(e.target.value)}
                  placeholder="e.g. once_per:10m"
                />
                <span className="text-[11px] text-muted-foreground">
                  Forms: <code>none</code> · <code>once_per:30s</code> · <code>max:5/1m</code> (units:{" "}
                  <code>s m h</code>)
                </span>
              </div>
            </div>
          </details>

          <DialogFooter>
            <Button
              type="submit"
              // `missing` is computed from the agent detail query — submitting
              // while it is still in flight would diff against an empty `held`
              // set and grant permissions the agent already has (or skip ones
              // it needs).
              disabled={
                create.isPending ||
                grantPermission.isPending ||
                detail.isLoading ||
                Boolean(filterError)
              }
            >
              Subscribe
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** First exact event type in the catalog — the dialog's default selection. */
const FIRST_EVENT = EVENT_CATALOG[0].events[0];

/**
 * Fire a synthetic event into the kernel bus to verify a subscription triggers
 * its agent (and to see the payload shape a filter would run against).
 */
function EmitEventDialog() {
  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState(FIRST_EVENT);
  const [severity, setSeverity] = useState("info");
  const [payload, setPayload] = useState(() => payloadSkeleton(FIRST_EVENT));
  const emit = useEmitEvent();

  // Re-seed the payload editor with the new event's fields when the type changes.
  function onEventChange(next: string) {
    setEventType(next);
    setPayload(payloadSkeleton(next));
  }

  function resetForm() {
    setEventType(FIRST_EVENT);
    setSeverity("info");
    setPayload(payloadSkeleton(FIRST_EVENT));
  }

  const payloadError = useMemo(() => {
    const text = payload.trim();
    if (!text) return null; // empty → send no payload
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "Payload must be a JSON object, e.g. { \"severity\": \"critical\" }.";
      }
      return null;
    } catch {
      return "Payload isn’t valid JSON.";
    }
  }, [payload]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (payloadError) {
      toast.error(payloadError);
      return;
    }
    // A synthetic event is a real event: every matching subscription spawns a
    // real agent task, spending real tokens and making real tool calls.
    const ok = await confirm({
      title: `Emit ${humanizeEvent(eventType)}?`,
      description:
        "Any agent subscribed to this event is triggered for real — real tasks, tool calls and token spend.",
      confirmLabel: "Emit",
    });
    if (!ok) return;
    const text = payload.trim();
    try {
      await emit.mutateAsync({
        event_type: eventType,
        severity,
        payload: text ? JSON.parse(text) : {},
      });
      toast.success(`Emitted ${humanizeEvent(eventType)}`);
      setOpen(false); // onOpenChange resets the form
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={open}
      // Reset on close: a hand-edited payload and severity must not survive
      // into the next, unrelated test emit.
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Emit test event</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Emit a test event</DialogTitle>
          <DialogDescription className="sr-only">
            Publish a synthetic event to exercise subscriptions.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Event type</span>
            <Select value={eventType} onChange={(e) => onEventChange(e.target.value)}>
              {EVENT_CATALOG.map((c) => (
                <optgroup key={c.value} label={c.label}>
                  {c.events.map((ev) => (
                    <option key={ev} value={ev}>{humanizeEvent(ev)}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Severity</span>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </Select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Payload (JSON)</span>
            <Textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={7}
              spellCheck={false}
              className={`font-mono text-xs ${payloadError ? "border-destructive" : ""}`}
            />
            {payloadError && <span className="text-[11px] text-destructive">{payloadError}</span>}
          </label>

          <DialogFooter>
            <Button type="submit" disabled={emit.isPending || Boolean(payloadError)}>
              Emit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EventsPage() {
  const query = useEventSubscriptions();
  const agents = useAgents();
  const del = useDeleteSubscription();
  const enableSub = useToggleSubscription("enable");
  const disableSub = useToggleSubscription("disable");
  const [agentFilter, setAgentFilter] = useState("");

  // Map agent UUID → display name so the table shows names, not raw ids.
  const agentNameById = useMemo(
    () => new Map((agents.data ?? []).map((a) => [a.id, a.name])),
    [agents.data],
  );

  // Removing a subscription silently stops an agent being triggered — the kind
  // of thing that is only noticed when the expected task never runs.
  async function onRemove(s: EventSubscription) {
    const who = agentNameById.get(s.agent_id) ?? s.agent_id ?? "this agent";
    const ok = await confirm({
      title: `Remove ${who}’s subscription?`,
      description: `${who} will no longer be triggered by “${prettifyFilter(s.event_type_filter)}”.`,
      destructive: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    del.mutateAsync(String(s.id)).then(() => toast.success("Removed")).catch(toastError);
  }

  const columns: Column<EventSubscription>[] = [
    {
      key: "filter",
      header: "Triggers on",
      cell: (s) => (
        <span className="font-medium" title={s.event_type_filter}>
          {prettifyFilter(s.event_type_filter)}
        </span>
      ),
    },
    {
      key: "agent",
      header: "Agent",
      cell: (s) => <span className="font-medium">{agentNameById.get(s.agent_id) ?? s.agent_id ?? "—"}</span>,
    },
    {
      key: "payload",
      header: "Payload filter",
      cell: (s) => <span className="text-xs text-muted-foreground">{s.payload_filter ?? "—"}</span>,
    },
    { key: "priority", header: "Priority", cell: (s) => s.priority ?? "—" },
    {
      key: "throttle",
      header: "Limit",
      cell: (s) => <span className="text-xs text-muted-foreground">{prettifyThrottle(s.throttle)}</span>,
    },
    { key: "enabled", header: "Status", cell: (s) => <StatusBadge status={s.enabled ? "active" : "paused"} /> },
    {
      key: "actions",
      header: "",
      cell: (s) => (
        <span className="flex justify-end gap-1">
          {s.enabled ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                disableSub
                  .mutateAsync(String(s.id))
                  .then(() => toast.success("Paused"))
                  .catch(toastError)
              }
            >
              Pause
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                enableSub
                  .mutateAsync(String(s.id))
                  .then(() => toast.success("Resumed"))
                  .catch(toastError)
              }
            >
              Resume
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onRemove(s)}>
            Remove
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Events"
        description="Subscribe agents to kernel events — a matching event triggers a task for the agent."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="max-w-[12rem]"
            >
              <option value="">All agents</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <EmitEventDialog />
            <SubscribeAgentDialog />
          </div>
        }
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Activity} title="No subscriptions" description="Subscribe an agent to start triggering it on events." action={<SubscribeAgentDialog />} />}
      >
        {(rows) => {
          const filtered = agentFilter ? rows.filter((s) => s.agent_id === agentFilter) : rows;
          // QueryState's `isEmpty` sees the unfiltered rows, so an agent with no
          // subscriptions would otherwise render bare column headers.
          if (filtered.length === 0) {
            return (
              <EmptyState
                icon={Activity}
                title="No subscriptions for this agent"
                description="Pick another agent, or subscribe this one to an event."
                action={<SubscribeAgentDialog />}
              />
            );
          }
          return <DataTable columns={columns} rows={filtered} getRowId={(s) => String(s.id)} />;
        }}
      </QueryState>
    </div>
  );
}

export function MarketplacePage() {
  const [q, setQ] = useState("");
  const [detailName, setDetailName] = useState<string | null>(null);
  const [debouncedQ, setDebouncedQ] = useState("");
  // Debounce so we don't fire a registry request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const query = useQuery({
    queryKey: ["marketplace", debouncedQ],
    queryFn: async () => {
      const data = unwrap<unknown>(
        await client.GET("/api/v1/marketplace", {
          params: { query: debouncedQ ? { q: debouncedQ } : {} },
        }),
      );
      return Array.isArray(data) ? data : [];
    },
  });
  return (
    <div>
      <PageHeader
        title="Marketplace"
        description="Browse the external tool registry."
        actions={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="max-w-xs" />}
      />
      <QueryState
        query={query}
        isEmpty={(d) => !Array.isArray(d) || d.length === 0}
        empty={<EmptyState icon={Store} title="No results" description="The registry is empty or unreachable." />}
      >
        {(items) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(items as Array<Record<string, unknown>>).map((it, i) => {
              // "" is not null, so an unnamed entry would open the detail dialog
              // on an empty title and request `/api/v1/marketplace/`.
              const name = String(it.name ?? it.id ?? "");
              return (
                <button
                  key={name || i}
                  disabled={!name}
                  className="rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/50 disabled:cursor-default disabled:opacity-60"
                  onClick={() => setDetailName(name)}
                >
                  <p className="font-medium">{name || "Unnamed entry"}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {String(it.description ?? "")}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </QueryState>
      <MarketplaceDetailDialog
        name={detailName}
        onOpenChange={(o) => !o && setDetailName(null)}
      />
    </div>
  );
}

// ── Skills (read-only library) ────────────────────────────────────────────────
function SkillTagRow({ label, tags }: { label: string; tags: string[] }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {tags.map((t) => (
          <Badge key={t} variant="muted">
            {t}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function SkillsPage() {
  const query = useSkills();
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useSkill(selected ?? "", selected != null);
  return (
    <div>
      <PageHeader
        title="Skills"
        description="Installed skills — reusable agent capabilities defined by SKILL.toml + a system prompt."
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Sparkles} title="No skills installed" />}
      >
        {(items) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((s) => (
              <button key={s.name} className="text-left" onClick={() => setSelected(s.name)}>
                <div className="h-full rounded-lg border border-border p-4 transition-colors hover:border-primary/50">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">{s.name}</p>
                    <Badge variant="muted">{s.trust_tier}</Badge>
                  </div>
                  <p className="mt-1 max-h-10 overflow-hidden text-sm text-muted-foreground">
                    {s.description}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    v{s.version} · {s.author}
                    {s.roles && s.roles.length ? ` · ${s.roles.join(", ")}` : ""}
                    {s.schedule ? ` · ⏱ ${s.schedule}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </QueryState>
      <Dialog open={selected != null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected}</DialogTitle>
            <DialogDescription className="sr-only">Skill details</DialogDescription>
          </DialogHeader>
          <QueryState query={detail}>
            {(d) => (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">{d.summary.description}</p>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">Version</p>
                    <p>{d.summary.version}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Author</p>
                    <p>{d.summary.author}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Trust tier</p>
                    <p>{d.summary.trust_tier}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Model</p>
                    <p>{d.default_model ?? d.default_provider ?? "default"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Max cost/run</p>
                    <p>${d.max_cost_per_run.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Max tokens/run</p>
                    <p>{d.max_tokens_per_run.toLocaleString()}</p>
                  </div>
                </div>
                {d.tools_required.length > 0 && (
                  <SkillTagRow label="Tools required" tags={d.tools_required} />
                )}
                {d.tools_optional.length > 0 && (
                  <SkillTagRow label="Tools optional" tags={d.tools_optional} />
                )}
                {d.permissions_required.length > 0 && (
                  <SkillTagRow label="Permissions" tags={d.permissions_required} />
                )}
                {d.summary.events && d.summary.events.length > 0 && (
                  <SkillTagRow label="Event triggers" tags={d.summary.events} />
                )}
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    System prompt
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                    {d.system_prompt}
                  </pre>
                </details>
              </div>
            )}
          </QueryState>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Phase 08 detail dialogs ──────────────────────────────────────────────────
export function PluginDetailDialog({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = usePluginDetail(id);
  return (
    <Dialog open={id != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogDescription className="sr-only">Plugin details</DialogDescription>
        <QueryState query={detail}>
          {(p) => (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {p.display_name} <Badge variant="outline">{p.trust_tier}</Badge>
                  <StatusBadge status={p.status} />
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">{p.description}</p>
                <p className="text-xs text-muted-foreground">
                  v{p.version} · by {p.author}
                  {p.memory_backend ? ` · memory: ${p.memory_backend}` : ""}
                </p>
                {p.blocked_reason && (
                  <p className="text-xs text-destructive">Blocked: {p.blocked_reason}</p>
                )}
                {(p.channels ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.channels.map((c) => (
                      <Badge key={c} variant="muted">{c}</Badge>
                    ))}
                  </div>
                )}
                {(p.tools ?? []).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Tools</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.tools.map((t) => (
                        <Badge key={t} variant="muted">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(p.permissions ?? []).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Permissions</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.permissions.map((perm) => (
                        <Badge key={perm} variant="muted">{perm}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

export function DiscoverPluginsButton() {
  const discover = useDiscoverPlugins();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={discover.isPending}
      onClick={() =>
        discover
          .mutateAsync()
          .then(() => toast.success("Plugin directories rescanned"))
          .catch(toastError)
      }
    >
      {discover.isPending ? "Scanning…" : "Discover"}
    </Button>
  );
}

export function ConnectorDetailDialog({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useConnectorDetail(id);
  return (
    <Dialog open={id != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogDescription className="sr-only">Connector details</DialogDescription>
        <QueryState query={detail}>
          {(c) => (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {c.name} <StatusBadge status={c.connected ? "connected" : "offline"} />
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                {c.description && <p className="text-muted-foreground">{c.description}</p>}
                <p className="text-xs text-muted-foreground">
                  {c.provider}
                  {c.version ? ` · v${c.version}` : ""}
                  {c.base_url ? ` · ${c.base_url}` : ""}
                  {c.expires_at ? ` · token expires ${relativeTime(c.expires_at)}` : ""}
                </p>
                {(c.scopes ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(c.scopes ?? []).map((s) => (
                      <Badge key={s} variant="muted">{s}</Badge>
                    ))}
                  </div>
                )}
                {(c.tools ?? []).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Tools</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(c.tools ?? []).map((t) => (
                        <Badge key={t} variant="muted">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

export function MarketplaceDetailDialog({
  name,
  onOpenChange,
}: {
  name: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useMarketplaceDetail(name);
  const review = useSubmitReview();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [authorKey, setAuthorKey] = useState("");
  useEffect(() => {
    setRating(5);
    setComment("");
    setAuthorKey("");
  }, [name]);
  return (
    <Dialog open={name != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription className="sr-only">Marketplace listing details</DialogDescription>
        </DialogHeader>
        <QueryState query={detail}>
          {(d) => (
            <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(d, null, 2)}
            </pre>
          )}
        </QueryState>
        <form
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name) return;
            review
              .mutateAsync({ name, rating, comment: comment.trim(), author_key: authorKey.trim() })
              .then(() => {
                toast.success("Review submitted");
                setComment("");
              })
              .catch(toastError);
          }}
        >
          <p className="text-sm font-medium">Leave a review</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant={rating === r ? "default" : "outline"}
                onClick={() => setRating(r)}
              >
                {r}★
              </Button>
            ))}
          </div>
          <Input
            value={authorKey}
            onChange={(e) => setAuthorKey(e.target.value)}
            placeholder="Your reviewer key id (public)"
          />
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What worked, what didn't…"
            className="min-h-[60px]"
          />
          <DialogFooter>
            <Button type="submit" size="sm" disabled={review.isPending || !comment.trim() || !authorKey.trim()}>
              {review.isPending ? "Submitting…" : "Submit review"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
