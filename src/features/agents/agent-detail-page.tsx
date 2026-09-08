import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, PowerOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAgent,
  useAgentCosts,
  useAgentIdentity,
  useAgentInbox,
  useAgentMemory,
  useAgentScratchPage,
  useAgentScratchpad,
  useDeleteAgentScratchPage,
  useDisconnectAgent,
  useRemoveAgent,
  useRevokePermission,
  useSaveAgentScratchPage,
  type MemoryTier,
} from "@/api/queries/agents";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime, tokens, usd } from "@/lib/format";
import { formatDuration } from "@/lib/task-duration";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { AgentSettingsDialog } from "./agent-settings-dialog";
import { GrantPermissionDialog } from "./grant-permission-dialog";
import { SegmentedControl } from "@/components/ui/segmented";

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
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
          Raw JSON
        </summary>
        <pre className="mt-2 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const MEMORY_TIERS: { tier: MemoryTier; label: string }[] = [
  { tier: "episodic", label: "Episodic" },
  { tier: "semantic", label: "Semantic" },
  { tier: "procedural", label: "Procedural" },
];

/** Read-only browse/search of an agent's 3-tier memory. */
function MemoryBrowser({ name }: { name: string }) {
  const [tier, setTier] = useState<MemoryTier>("episodic");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  // Debounce so we don't fire a search per keystroke (same as Marketplace).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const query = useAgentMemory(name, tier, debouncedQ);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Memory tier"
            options={MEMORY_TIERS.map((t) => ({ value: t.tier, label: t.label }))}
            value={tier}
            onChange={setTier}
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this tier…"
            className="ml-auto max-w-xs"
          />
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">
              No {tier} memory{q.trim() ? " matches" : " yet"}.
            </p>
          }
        >
          {(items) => (
            <div className="space-y-2">
              {items.map((m) => (
                <div key={`${m.tier}-${m.id}`} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{m.title}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="muted">{m.kind}</Badge>
                      {m.score != null && (
                        <span className="text-xs text-muted-foreground">{m.score.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                  {m.content && (
                    <p className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                      {m.content}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">{relativeTime(m.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

/** Read-only agent-to-agent message timeline. */
function InboxTimeline({ name }: { name: string }) {
  const query = useAgentInbox(name);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbox · agent-to-agent</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState
          query={query}
          isEmpty={(d) => d.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
          }
        >
          {(items) => (
            <div className="space-y-2">
              {items.map((m) => (
                <div key={m.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm">
                      <code className="text-xs">{m.from.slice(0, 8)}</code>
                      <span className="text-muted-foreground"> → {m.to}</span>
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="muted">{m.kind}</Badge>
                      {m.signed && <span className="text-xs text-muted-foreground">signed</span>}
                    </div>
                  </div>
                  {m.preview && (
                    <p className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                      {m.preview}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {relativeTime(m.timestamp)}
                    {m.reply_to ? " · reply" : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

export function AgentDetailPage() {
  const { name } = useParams({ strict: false }) as { name: string };
  const navigate = useNavigate();
  const query = useAgent(name);
  const identity = useAgentIdentity(name);
  const disconnect = useDisconnectAgent();
  const remove = useRemoveAgent();
  const revoke = useRevokePermission(name);

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
    <div>
      <div className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
        <Button asChild variant="ghost" size="icon">
          <Link to="/agents">
            <ArrowLeft />
          </Link>
        </Button>
        Agents
      </div>
      <QueryState query={query}>
        {(detail) => {
          const a = detail.summary;
          return (
            <div className="space-y-6 pb-10">
              <PageHeader
                title={a.name}
                description={`${a.provider} · ${a.model}`}
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
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} />
                {a.roles.map((r) => (
                  <Badge key={r} variant="muted">
                    {r}
                  </Badge>
                ))}
                {a.supports_images && <Badge variant="secondary">images</Badge>}
                {detail.provider_healthy === false && (
                  <Badge
                    variant="outline"
                    className="border-destructive/50 text-destructive"
                    title="The agent's LLM provider did not answer a health check"
                  >
                    provider unreachable
                  </Badge>
                )}
                {detail.provider_healthy === true && (
                  <Badge variant="outline" title="The agent's LLM provider answered a health check">
                    provider ok
                  </Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  connected {relativeTime(a.connected_at)}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                    <CardTitle>Permissions</CardTitle>
                    <GrantPermissionDialog name={name} granted={detail.permissions} />
                  </CardHeader>
                  <CardContent>
                    {detail.permissions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No permissions granted. Use Grant to see what {name} can be given.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {detail.permissions.map((p) => (
                          <li
                            key={p}
                            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
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

                <Card>
                  <CardHeader>
                    <CardTitle>Recent tasks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {detail.recent_tasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recent tasks.</p>
                    ) : (
                      <ul className="space-y-1">
                        {detail.recent_tasks.map((t) => (
                          <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                            <Link
                              to="/tasks/$id"
                              params={{ id: t.id }}
                              className="truncate hover:underline"
                            >
                              {t.prompt_preview}
                            </Link>
                            <StatusBadge status={t.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              {identity.data && (
                <Card>
                  <CardHeader>
                    <CardTitle>Identity</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Fingerprint</p>
                      <code className="break-all">{identity.data.fingerprint}</code>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <StatusBadge status={identity.data.status} />
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground">Public key</p>
                      <code className="break-all text-xs text-muted-foreground">
                        {identity.data.public_key_hex}
                      </code>
                    </div>
                  </CardContent>
                </Card>
              )}

              <MemoryBrowser name={name} />

              <InboxTimeline name={name} />

              <AgentCostCard name={name} />

              <AgentScratchpadCard name={name} />

              {detail.cost_snapshot != null && (
                <Card>
                  <CardHeader>
                    <CardTitle>Cost snapshot</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CostSnapshotView snapshot={detail.cost_snapshot} />
                  </CardContent>
                </Card>
              )}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}

/** Current-period cost/budget snapshot for one agent. */
function AgentCostCard({ name }: { name: string }) {
  const query = useAgentCosts(name);
  if (query.isError) return null; // no cost data recorded yet — skip the card
  return (
    <Card>
      <CardHeader>
        <CardTitle>Costs (current period)</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState query={query}>
          {(c) => (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Spend</p>
                <p className="font-medium">
                  ${c.cost_usd.toFixed(4)}
                  {c.cost_pct != null ? ` (${Math.round(c.cost_pct)}%)` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tokens</p>
                <p className="font-medium">
                  {c.tokens_used.toLocaleString()}
                  {c.tokens_pct != null ? ` (${Math.round(c.tokens_pct)}%)` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tool calls</p>
                <p className="font-medium">{c.tool_calls}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Budget exhausts</p>
                <p className="font-medium">
                  {c.forecast_exhaustion_hours != null
                    ? `~${Math.round(c.forecast_exhaustion_hours)}h`
                    : "—"}
                </p>
              </div>
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

/** Agent-scoped scratchpad: list, edit, delete pages owned by this agent. */
function AgentScratchpadCard({ name }: { name: string }) {
  const list = useAgentScratchpad(name);
  const [page, setPage] = useState<string | null>(null);
  const detail = useAgentScratchPage(name, page);
  const save = useSaveAgentScratchPage(name);
  const del = useDeleteAgentScratchPage(name);
  const [content, setContent] = useState("");
  // The text the server last confirmed for this page. Unlike the scratchpad
  // dialog, this editor stays open after a save — and the save invalidates the
  // very query it renders from. Without a baseline to compare against, that
  // refetch silently replaces everything typed since with the server copy.
  //
  // State, not a ref: `dirty` and the `useBlocker` inside `useDirtyGuard` are
  // both derived from it, and a ref assignment renders nothing — so after a
  // save the blocker stayed armed and a fully-saved document still prompted
  // "Discard unsaved changes?" (and "Leave site?" on reload). Training people
  // to click through a false prompt is how they click through the true one.
  const [baseline, setBaseline] = useState<string | null>(null);
  const dirty = baseline != null && content !== baseline;
  const { confirmDiscard } = useDirtyGuard(dirty);

  // A different page is a different document: clear the baseline so the sync
  // below treats the incoming content as a first load rather than a remote edit.
  useEffect(() => {
    setBaseline(null);
    setContent("");
  }, [page]);

  useEffect(() => {
    const server = detail.data?.content;
    if (server == null) return;
    // Adopt the server copy on first load, and on a genuine remote edit — but
    // only while the editor is untouched, never over unsaved keystrokes.
    const remoteEdit = server !== baseline && content === baseline;
    if (baseline === null || remoteEdit) {
      setBaseline(server);
      setContent(server);
    }
    // Deliberately not keyed on `baseline`: a save sets it while the query it
    // invalidated still holds the *pre-save* copy, so re-running here would see
    // an untouched editor against a "different" server value and revert the
    // text that was just saved. Only new server data or new keystrokes should
    // re-evaluate; the closure already reads the latest baseline when they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, content]);

  // Switching pages stays on the same route, so `useDirtyGuard`'s blocker never
  // sees it — ask here instead.
  async function selectPage(title: string) {
    if (title === page || !(await confirmDiscard())) return;
    setPage(title);
  }

  function onSave() {
    if (save.isPending || page == null) return;
    const sent = content;
    save
      .mutateAsync(
        { page, content: sent },
        {
          // Baseline what we sent, so the refetch this save triggers reads as
          // the same document. If the server normalised the body the next load
          // differs from the baseline and is adopted — but only if nothing was
          // typed since. In `onSuccess` rather than a `.then()` so clearing the
          // dirty guard does not ride on promise/network ordering.
          onSuccess: () => setBaseline(sent),
        },
      )
      .then(() => toast.success("Saved"))
      .catch(toastError);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scratchpad</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState
          query={list}
          isEmpty={(d) => d.pages.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">
              No private pages for this agent.
            </p>
          }
        >
          {(data) => (
            <div className="flex flex-wrap gap-1.5">
              {data.pages.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={page === p.title ? "default" : "outline"}
                  onClick={() => void selectPage(p.title)}
                >
                  {p.title}
                </Button>
              ))}
            </div>
          )}
        </QueryState>
        {page != null && (
          <div className="mt-3 space-y-2">
            {detail.isPending || !detail.data ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[160px] font-mono text-xs"
              />
            )}
            <div className="flex items-center justify-end gap-2">
              {dirty && <span className="mr-auto text-xs text-warning">Unsaved changes</span>}
              <Button
                size="sm"
                variant="destructive"
                disabled={del.isPending}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: `Delete "${page}"?`,
                      description: `This page is removed from ${name}'s scratchpad.`,
                      destructive: true,
                      confirmLabel: "Delete",
                    }))
                  )
                    return;
                  del
                    .mutateAsync(page)
                    .then(() => {
                      toast.success("Deleted");
                      setPage(null);
                    })
                    .catch(toastError);
                }}
              >
                Delete
              </Button>
              <Button size="sm" disabled={save.isPending || !detail.data} onClick={onSave}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
