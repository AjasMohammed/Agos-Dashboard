import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Coins,
  Cpu,
  ListChecks,
  PowerOff,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  useAgent,
  useAgentCosts,
  useAgentInbox,
  useAgentScratchpad,
  useDisconnectAgent,
  useRemoveAgent,
  useRevokePermission,
} from "@/api/queries/agents";
import type { TaskSummary } from "@/api/models";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { When } from "@/components/when";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { toneFor } from "@/lib/status-tone";
import { AgentAvatar } from "@/components/agent-avatar";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime, tokens, usd } from "@/lib/format";
import { formatDuration } from "@/lib/task-duration";
import { AgentSettingsDialog } from "./agent-settings-dialog";
import { GrantPermissionDialog } from "./grant-permission-dialog";
import { AgentMcpCard } from "./agent-mcp-card";
import { AgentMemoryCard } from "./agent-memory-card";
import { AgentInboxCard } from "./agent-inbox-card";
import { AgentIdentityCard } from "./agent-identity-card";
import { AgentScratchpadCard } from "./agent-scratchpad-card";
import { isMcpResource, parsePermission } from "./permission-catalog";

/**
 * `cost_snapshot` is typed as an opaque object in the contract; this mirrors
 * the kernel's `CostSnapshot` (agos agentos-types/src/task.rs). Every field is
 * optional so drift renders "—" instead of throwing.
 */
interface CostSnapshotShape {
  period_start?: string;
  tokens_used?: number;
  cost_usd?: number;
  tool_calls?: number;
  tokens_pct?: number;
  cost_pct?: number;
  tool_calls_pct?: number;
  forecast_exhaustion_hours?: number | null;
  budget?: {
    max_tokens_per_day?: number;
    max_cost_usd_per_day?: number;
    max_tool_calls_per_day?: number;
  };
}

function CostSnapshotView({ snapshot }: { snapshot: object }) {
  const s = snapshot as CostSnapshotShape;
  const b = s.budget ?? {};
  // "used / limit (pct%)"; a 0 limit means unlimited in the kernel.
  const usage = (
    fmt: (n: number | undefined) => string,
    used: number | undefined,
    limit: number | undefined,
    pct: number | undefined,
  ) => (limit ? `${fmt(used)} / ${fmt(limit)} (${Math.round(pct ?? 0)}%)` : fmt(used));
  const count = (n: number | undefined) => (n == null ? "—" : String(n));
  const rows: [string, string][] = [
    ["Tokens today", usage(tokens, s.tokens_used, b.max_tokens_per_day, s.tokens_pct)],
    ["Cost today", usage(usd, s.cost_usd, b.max_cost_usd_per_day, s.cost_pct)],
    ["Tool calls today", usage(count, s.tool_calls, b.max_tool_calls_per_day, s.tool_calls_pct)],
    ["Period started", relativeTime(s.period_start)],
  ];
  if (s.forecast_exhaustion_hours != null) {
    rows.push(["Budget exhausted in", formatDuration(s.forecast_exhaustion_hours * 3_600_000)]);
  }
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 py-1.5">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="tnum font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary className="cursor-pointer select-none text-xs text-muted-foreground transition-colors hover:text-foreground">
          Raw JSON
        </summary>
        <pre className="mt-2 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/** MCP server grants live in their own card, not the generic list. */
function generalPermissions(permissions: string[]): string[] {
  return permissions.filter((p) => !isMcpResource(parsePermission(p)?.resource ?? ""));
}

/**
 * `Stat` has no "muted" tone, so an unknown status simply goes untinted — the
 * mapping itself is `StatusBadge`'s, so the number and the badge beside it can
 * never tell different stories about the same word.
 */
function statusTone(status: string): "success" | "warning" | "danger" | "info" | undefined {
  const tone = toneFor(status);
  return tone === "muted" ? undefined : tone;
}

// API vocabulary (crates/agentos-api/src/util.rs):
// queued running waiting suspended complete failed cancelled
const TASK_RUNNING = ["running", "queued", "waiting", "suspended"];
const TASK_FAILED = ["failed", "cancelled"];

/**
 * At-a-glance health and budget. Every value is a real field — `useAgentCosts`
 * 404s for an agent that has not spent anything yet, which is a legitimate
 * "nothing recorded" rather than an error, so those three stats show "—".
 */
function AgentMetrics({
  name,
  status,
  provider,
  model,
  lastActive,
  providerHealthy,
  tasks,
}: {
  name: string;
  status: string;
  provider: string;
  model: string;
  lastActive: string | null | undefined;
  providerHealthy: boolean | null | undefined;
  tasks: TaskSummary[];
}) {
  const costs = useAgentCosts(name);
  const c = costs.data;
  // Three states, not two: still loading says nothing, an error or an empty
  // result says "nothing recorded". Collapsing the first into the third made the
  // row assert "No budget set" for the length of the fetch and then contradict
  // itself — a claim about data nobody had yet.
  const hint = costs.isLoading ? "Loading…" : !c ? "No cost data yet" : undefined;
  // A budget exists only when its limit is > 0; a `*_pct` of 0 is what an
  // unbudgeted agent reports too, so it can never decide this.
  const budgeted = (limit: number | null | undefined) => limit != null && limit > 0;
  const running = tasks.filter((t) => TASK_RUNNING.includes(t.status));
  const failed = tasks.filter((t) => TASK_FAILED.includes(t.status));

  return (
    <StatGrid min={150}>
      <Stat
        icon={Activity}
        label="Status"
        value={<span className="capitalize">{status.replace(/_/g, " ")}</span>}
        tone={statusTone(status)}
        hint={<When iso={lastActive} prefix="last active" />}
      />
      <Stat
        icon={Cpu}
        label="Provider"
        value={providerHealthy == null ? "Unknown" : providerHealthy ? "Healthy" : "Unreachable"}
        tone={providerHealthy == null ? undefined : providerHealthy ? "success" : "danger"}
        // Truncated in the tile — the full model id is long, so keep it on hover.
        hint={<span title={`${provider} · ${model}`}>{`${provider} · ${model}`}</span>}
      />
      <Stat
        icon={Coins}
        label="Spend today"
        value={c ? usd(c.cost_usd) : "—"}
        // The exhaustion forecast rides here rather than in a seventh tile. It
        // used to live in the deleted `AgentCostCard` and exists nowhere else
        // for an agent whose `cost_snapshot` is null.
        hint={
          hint ??
          [
            c && budgeted(c.budget?.max_cost_usd_per_day)
              ? `${Math.round(c.cost_pct ?? 0)}% of ${usd(c.budget?.max_cost_usd_per_day)}`
              : "No budget set",
            c?.forecast_exhaustion_hours != null
              ? `~${Math.round(c.forecast_exhaustion_hours)}h left`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        }
      />
      <Stat
        icon={Zap}
        label="Tokens"
        value={c ? tokens(c.tokens_used) : "—"}
        hint={
          hint ??
          (c && budgeted(c.budget?.max_tokens_per_day)
            ? `${Math.round(c.tokens_pct ?? 0)}% of ${tokens(c.budget?.max_tokens_per_day)}`
            : "No budget set")
        }
      />
      <Stat
        icon={Wrench}
        label="Tool calls"
        value={c ? c.tool_calls.toLocaleString() : "—"}
        hint={hint ?? <When iso={c?.period_start} prefix="since" />}
      />
      <Stat
        icon={ListChecks}
        label="Recent tasks"
        value={tasks.length}
        hint={
          tasks.length === 0 ? "None yet" : `${running.length} running · ${failed.length} failed`
        }
      />
    </StatGrid>
  );
}

const TASK_COLUMNS: Column<TaskSummary>[] = [
  {
    key: "prompt",
    header: "Task",
    // `w-full` makes this column absorb the width the other two don't need;
    // `max-w-0` then lets it shrink so `truncate` has something to act on in an
    // auto-layout table. Without the pair, the prompt truncates to its own
    // content width with the rest of the row left empty.
    className: "w-full max-w-0",
    // A real link, not just the row's click handler: triage means ⌘-clicking
    // three failed tasks into tabs, and "Copy link address". `DataTable` ignores
    // clicks that land on an `<a>`, so the row handler still covers the rest of
    // the row.
    cell: (t) => (
      <Link
        to="/tasks/$id"
        params={{ id: t.id }}
        className="block truncate hover:underline"
        title={t.prompt_preview}
      >
        {t.prompt_preview}
      </Link>
    ),
  },
  { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
  {
    key: "created",
    header: "Created",
    align: "right",
    cell: (t) => <When iso={t.created_at} className="text-muted-foreground" />,
  },
];

export function AgentDetailPage() {
  const { name } = useParams({ strict: false }) as { name: string };
  const navigate = useNavigate();
  const query = useAgent(name);
  const disconnect = useDisconnectAgent();
  const remove = useRemoveAgent();
  const revoke = useRevokePermission(name);
  const [tab, setTab] = useState("overview");
  // Tab counts. React Query dedupes by key, so the tab body's own call to these
  // same hooks is a cache read rather than a second request.
  const inbox = useAgentInbox(name);
  const scratchpad = useAgentScratchpad(name);

  async function onDisconnect() {
    // A second click while the DELETE is in flight 404s and lands a red toast
    // on top of the success one, on a page we are already navigating away from.
    if (disconnect.isPending) return;
    const ok = await confirm({
      title: `Disconnect ${name}?`,
      description: `${name} stops accepting work and its provider connection is released. The profile is kept, so reconnecting reuses the same identity and memories.`,
      destructive: true,
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    try {
      await disconnect.mutateAsync(name);
      toast.success(`Disconnected ${name}`);
      navigate({ to: "/agents" });
    } catch (e) {
      toastError(e);
    }
  }

  async function onRemove() {
    if (remove.isPending) return; // same double-submit guard as Disconnect
    const ok = await confirm({
      title: `Remove ${name} permanently?`,
      description:
        `Deletes ${name}'s profile, identity, memories, scratchpad, inbox, checkpoints and schedules. ` +
        "Stored credentials and the audit log are kept. This cannot be undone.",
      destructive: true,
      confirmLabel: "Remove permanently",
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(name);
      toast.success(`Removed ${name}`);
      navigate({ to: "/agents" });
    } catch (e) {
      toastError(e);
    }
  }

  async function onRevoke(permission: string) {
    if (revoke.isPending) return; // same double-submit as Disconnect
    const ok = await confirm({
      title: `Revoke "${permission}" from ${name}?`,
      description: "The agent loses this capability on its next tool call.",
      destructive: true,
      confirmLabel: "Revoke",
    });
    if (!ok) return;
    try {
      await revoke.mutateAsync(permission);
      toast.success(`Revoked ${permission}`);
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div className="pb-10">
      <QueryState query={query}>
        {(detail) => {
          const a = detail.summary;
          const perms = generalPermissions(detail.permissions);
          return (
            <div className="space-y-5">
              <PageHeader
                back={
                  <Link
                    to="/agents"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5" /> Agents
                  </Link>
                }
                title={
                  <span className="flex items-center gap-3">
                    <AgentAvatar name={a.name} src={a.avatar} className="size-9 text-sm" />
                    {a.name}
                  </span>
                }
                description={detail.description || `${a.provider} · ${a.model}`}
                meta={
                  <>
                    <StatusBadge status={a.status} />
                    {a.roles.map((r) => (
                      <Badge key={r} variant="muted">
                        {r}
                      </Badge>
                    ))}
                    {a.supports_images && <Badge variant="secondary">images</Badge>}
                    {detail.thinking_level && (
                      <Badge variant="outline" title="Default reasoning depth for this agent">
                        thinking: {detail.thinking_level}
                      </Badge>
                    )}
                    <span className="text-sm text-muted-foreground">
                      <When iso={a.connected_at} prefix="connected" />
                    </span>
                  </>
                }
                actions={
                  <>
                    <AgentSettingsDialog name={name} />
                    {/* Disconnect is rejected by the kernel once the agent is
                        already offline — Remove is the action that still applies. */}
                    <Button
                      variant="outline"
                      onClick={onDisconnect}
                      disabled={disconnect.isPending || a.status === "offline"}
                    >
                      <PowerOff /> Disconnect
                    </Button>
                    <Button variant="destructive" onClick={onRemove} disabled={remove.isPending}>
                      <Trash2 /> Remove
                    </Button>
                  </>
                }
              />

              <AgentMetrics
                name={name}
                status={a.status}
                provider={a.provider}
                model={a.model}
                lastActive={a.last_active}
                providerHealthy={detail.provider_healthy}
                tasks={detail.recent_tasks}
              />

              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="access" count={detail.permissions.length}>
                    Access
                  </TabsTrigger>
                  <TabsTrigger value="memory">Memory</TabsTrigger>
                  <TabsTrigger value="inbox" count={inbox.data?.length}>
                    Inbox
                  </TabsTrigger>
                  <TabsTrigger value="scratchpad" count={scratchpad.data?.pages.length}>
                    Scratchpad
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                  {/* Tasks take the wide column; the reference cards stack beside
                      them on a wide screen and below them on anything narrower. */}
                  <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                    <div className="min-w-0">
                      <SectionHeader title="Recent tasks" count={detail.recent_tasks.length} />
                      <DataTable
                        columns={TASK_COLUMNS}
                        rows={detail.recent_tasks}
                        getRowId={(t) => t.id}
                        onRowClick={(t) => navigate({ to: "/tasks/$id", params: { id: t.id } })}
                        maxHeight="20rem"
                        emptyMessage={`${name} has not run a task yet.`}
                      />
                    </div>
                    <div className="min-w-0 space-y-4">
                      {detail.cost_snapshot != null && (
                        <Card>
                          <CardHeader>
                            <CardTitle>Budget snapshot</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <CostSnapshotView snapshot={detail.cost_snapshot} />
                          </CardContent>
                        </Card>
                      )}
                      <AgentIdentityCard name={name} />
                      {detail.system_prompt && (
                        <Card>
                          <CardHeader>
                            <CardTitle>System prompt</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                              {detail.system_prompt}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="access">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                        <CardTitle>Permissions</CardTitle>
                        <GrantPermissionDialog name={name} granted={detail.permissions} />
                      </CardHeader>
                      <CardContent>
                        {/* Gated on the full grant list, not the filtered one:
                            an agent with only MCP grants has permissions, they
                            are just rendered in the card next door. */}
                        {detail.permissions.length === 0 ? (
                          <EmptyState
                            compact
                            title="No permissions granted"
                            description={`Use Grant to see what ${name} can be given.`}
                          />
                        ) : perms.length === 0 ? (
                          <EmptyState
                            compact
                            title="No direct permissions"
                            description="This agent's access comes from its MCP server grants."
                          />
                        ) : (
                          <ul className="max-h-80 space-y-1 overflow-y-auto">
                            {perms.map((p) => (
                              <li
                                key={p}
                                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:border-input"
                              >
                                <code className="truncate">{p}</code>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={revoke.isPending}
                                  onClick={() => void onRevoke(p)}
                                >
                                  Revoke
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                    <AgentMcpCard name={name} granted={detail.permissions} />
                  </div>
                </TabsContent>

                <TabsContent value="memory">
                  <AgentMemoryCard name={name} />
                </TabsContent>

                <TabsContent value="inbox">
                  <AgentInboxCard name={name} />
                </TabsContent>

                {/* Force-mounted so unsaved editor text survives a tab switch —
                    hidden by class rather than unmounted. */}
                <TabsContent value="scratchpad" forceMount className="data-[state=inactive]:hidden">
                  <AgentScratchpadCard name={name} />
                </TabsContent>
              </Tabs>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
