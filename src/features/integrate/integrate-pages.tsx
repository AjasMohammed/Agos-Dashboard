import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Puzzle, Radio, Plug, Link2, Webhook, Activity, Store } from "lucide-react";
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
} from "@/api/queries/extensibility";
import { useAgents, useAgent, useGrantAgentPermission } from "@/api/queries/agents";
import { EVENT_CATALOG, requiredResourcesFor, humanizeEvent } from "./event-catalog";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
  const columns: Column<PluginSummary>[] = [
    { key: "name", header: "Name", cell: (p) => <span className="font-medium">{p.display_name}</span> },
    { key: "version", header: "Version", cell: (p) => <span className="text-muted-foreground">{p.version}</span> },
    { key: "trust", header: "Trust", cell: (p) => <Badge variant="outline">{p.trust_tier}</Badge> },
    { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
    {
      key: "actions",
      header: "",
      cell: (p) =>
        p.status === "active" ? (
          <Button variant="ghost" size="sm" onClick={() => disable.mutateAsync(p.id).catch(toastError)}>
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
      <PageHeader title="Plugins" description="Installed plugin manifests." />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Puzzle} title="No plugins" />}>
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(p) => p.id} />}
      </QueryState>
    </div>
  );
}

export function ChannelsPage() {
  const query = useChannels();
  const disconnect = useDisconnectChannel();
  async function onDisconnect(id: string) {
    if (!(await confirm({ title: "Disconnect channel?", destructive: true, confirmLabel: "Disconnect" }))) return;
    disconnect.mutateAsync(id).then(() => toast.success("Disconnected")).catch(toastError);
  }
  const columns: Column<ChannelSummary>[] = [
    { key: "kind", header: "Kind", cell: (c) => <Badge variant="muted">{c.kind}</Badge> },
    { key: "name", header: "Name", cell: (c) => <span className="font-medium">{c.display_name}</span> },
    { key: "health", header: "Health", cell: (c) => <StatusBadge status={c.health ?? "unknown"} /> },
    { key: "active", header: "Last active", cell: (c) => <span className="text-muted-foreground">{relativeTime(c.last_active)}</span> },
    { key: "actions", header: "", cell: (c) => <Button variant="ghost" size="sm" onClick={() => onDisconnect(c.id)}>Disconnect</Button> },
  ];
  return (
    <div>
      <PageHeader title="Channels" description="Connected notification channels." />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Radio} title="No channels" />}>
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(c) => c.id} />}
      </QueryState>
    </div>
  );
}

export function McpPage() {
  const query = useMcpServers();
  const detach = useDetachMcp();
  const columns: Column<McpServer>[] = [
    { key: "name", header: "Name", cell: (m) => <span className="font-medium">{m.name}</span> },
    { key: "command", header: "Command", cell: (m) => <code className="text-xs text-muted-foreground">{m.command}</code> },
    { key: "state", header: "State", cell: (m) => <StatusBadge status={m.state ?? "unknown"} /> },
    { key: "actions", header: "", cell: (m) => <Button variant="ghost" size="sm" onClick={() => detach.mutateAsync(m.name).then(() => toast.success("Detached")).catch(toastError)}>Detach</Button> },
  ];
  return (
    <div>
      <PageHeader title="MCP servers" description="Attached Model Context Protocol servers." />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Plug} title="No MCP servers" />}>
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(m) => m.name} />}
      </QueryState>
    </div>
  );
}

export function ConnectorsPage() {
  const query = useConnectors();
  const disconnect = useDisconnectConnector();
  const columns: Column<ConnectorSummary>[] = [
    { key: "name", header: "Name", cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: "provider", header: "Provider", cell: (c) => c.provider },
    { key: "connected", header: "Status", cell: (c) => <StatusBadge status={c.connected ? "connected" : "offline"} /> },
    { key: "scopes", header: "Scopes", cell: (c) => <span className="text-xs text-muted-foreground">{(c.scopes ?? []).join(", ") || "—"}</span> },
    { key: "actions", header: "", cell: (c) => <Button variant="ghost" size="sm" onClick={() => disconnect.mutateAsync(c.id).then(() => toast.success("Disconnected")).catch(toastError)}>Disconnect</Button> },
  ];
  return (
    <div>
      <PageHeader title="Connectors" description="OAuth connectors for external services." />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Link2} title="No connectors" />}>
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(c) => c.id} />}
      </QueryState>
    </div>
  );
}

function CreateWebhookDialog() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("generic");
  const [agent, setAgent] = useState("");
  const agents = useAgents();
  const create = useCreateWebhook();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await create.mutateAsync({ agent_name: agent || (agents.data?.[0]?.name ?? ""), provider });
      toast.success("Webhook created");
      if (res.inbound_url) toast.message("Inbound URL", { description: res.inbound_url });
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New webhook</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create webhook</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Provider (e.g. generic, github)" />
          <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">{agents.data?.length ? "Target agent…" : "No agents"}</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={a.name}>{a.name}</option>
            ))}
          </Select>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WebhooksPage() {
  const query = useWebhooks();
  const del = useDeleteWebhook();
  const rotate = useRotateWebhook();
  async function onDelete(id: string) {
    if (!(await confirm({ title: "Delete webhook?", destructive: true, confirmLabel: "Delete" }))) return;
    del.mutateAsync(id).then(() => toast.success("Deleted")).catch(toastError);
  }
  function onRotate(id: string) {
    rotate
      .mutateAsync(id)
      .then((res) => toast.success("Secret rotated", { description: res.secret ? `New secret: ${res.secret}` : undefined }))
      .catch(toastError);
  }
  const columns: Column<WebhookEndpoint>[] = [
    { key: "provider", header: "Provider", cell: (w) => <Badge variant="muted">{w.provider}</Badge> },
    { key: "url", header: "Inbound URL", cell: (w) => <code className="text-xs text-muted-foreground line-clamp-1">{w.inbound_url}</code> },
    { key: "active", header: "Status", cell: (w) => <StatusBadge status={w.active ? "active" : "paused"} /> },
    { key: "count", header: "Received", cell: (w) => <span className="text-muted-foreground">{w.total_received}</span> },
    {
      key: "actions",
      header: "",
      cell: (w) => (
        <span className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => onRotate(String(w.id))}>Rotate</Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(String(w.id))}>Delete</Button>
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
    try {
      // Optionally grant the missing observe access first, so the agent can
      // manage/act on the subscription. Best-effort per resource; a failed
      // grant still lets the subscription be created (operator override).
      if (grant && missing.length > 0) {
        await Promise.all(
          missing.map((r) =>
            grantPermission
              .mutateAsync({ name: agent, permission: `${r}:o` })
              .catch(() => undefined),
          ),
        );
      }
      await create.mutateAsync({
        agent_name: agent,
        event_filter: selection,
        priority,
        payload_filter: payloadFilter.trim() || null,
        throttle: throttle.trim() || null,
      });
      toast.success("Subscription created");
      resetForm();
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Subscribe agent</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribe an agent to events</DialogTitle>
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
            <div className="mt-2 grid gap-2">
              <Input
                value={payloadFilter}
                onChange={(e) => setPayloadFilter(e.target.value)}
                placeholder="Payload filter (e.g. severity == critical)"
              />
              <Input
                value={throttle}
                onChange={(e) => setThrottle(e.target.value)}
                placeholder="Throttle (e.g. once_per:30s or max:5/1m)"
              />
            </div>
          </details>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending || grantPermission.isPending}>
              Subscribe
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
  const [agentFilter, setAgentFilter] = useState("");

  // Map agent UUID → display name so the table shows names, not raw ids.
  const agentNameById = new Map((agents.data ?? []).map((a) => [a.id, a.name]));

  const columns: Column<EventSubscription>[] = [
    { key: "filter", header: "Event filter", cell: (s) => <code className="text-xs">{s.event_type_filter}</code> },
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
    { key: "enabled", header: "Status", cell: (s) => <StatusBadge status={s.enabled ? "active" : "paused"} /> },
    {
      key: "actions",
      header: "",
      cell: (s) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => del.mutateAsync(String(s.id)).then(() => toast.success("Removed")).catch(toastError)}
        >
          Remove
        </Button>
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
          return <DataTable columns={columns} rows={filtered} getRowId={(s) => String(s.id)} />;
        }}
      </QueryState>
    </div>
  );
}

export function MarketplacePage() {
  const [q, setQ] = useState("");
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
            {(items as Array<Record<string, unknown>>).map((it, i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <p className="font-medium">{String(it.name ?? it.id ?? "item")}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {String(it.description ?? "")}
                </p>
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
