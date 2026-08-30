/* eslint-disable react-refresh/only-export-components --
   the pure decision helpers below (option classification, bulk split, grant
   blast radius) are exported so they can be unit-tested without mounting the
   page; they carry no component state. */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ShieldAlert, KeyRound, SlidersHorizontal, ScrollText, Info } from "lucide-react";
import {
  useEscalations,
  useResolveEscalation,
  useRoles,
  useCreateRole,
  useDeleteRole,
  usePrefProposals,
  usePrefStats,
  useReviewProposal,
  useAuditLogs,
  useApprovalPolicies,
  useAddApprovalPolicy,
  useRevokeApprovalPolicy,
  useVerifyAudit,
  useAuditTrace,
} from "@/api/queries/governance";
import {
  useNotifications,
  useDismissNotification,
  useRespondNotification,
  useClearReadNotifications,
} from "@/api/queries/notifications";
import { useAgents } from "@/api/queries/agents";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useAuthStore } from "@/auth/store";
import { cn } from "@/lib/utils";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { agentLabel, useAgentNames } from "@/lib/agent-names";
import { senderAgentId } from "@/features/activity/activity-feed";
import { AuditRows } from "@/features/dashboard/audit-rows";
import type {
  AddApprovalPolicyBody,
  ApprovalPolicy,
  Escalation,
  NotificationSummary,
  Role,
  PrefProposal,
} from "@/api/models";

/**
 * Add/remove ids in a per-row in-flight (or selection) `Set`. Rows track their
 * own pending state because a shared `mutation.isPending` disables *every*
 * row's button, not just the one that was clicked.
 */
function withIds<T>(prev: ReadonlySet<T>, ids: readonly T[], on: boolean): ReadonlySet<T> {
  const next = new Set(prev);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

// ── Escalations ─────────────────────────────────────────────────────────────

/** Group order for the review queue — most urgent first, unknown urgencies last. */
const URGENCY_ORDER = ["critical", "high", "normal", "low"];
const urgencyRank = (u: string) => {
  const i = URGENCY_ORDER.indexOf(u.toLowerCase());
  return i === -1 ? URGENCY_ORDER.length : i;
};

const escOptions = (e: Escalation) => e.options ?? ["approve", "deny"];

/**
 * The escalation's OWN spelling of `decision`, or `undefined` when it doesn't
 * offer it. Matching is case/space-insensitive — an agent that emits
 * `["Approve", "Deny"]` used to be unresolvable in bulk (every row landed in
 * `skipped`) while its per-row buttons worked — but the original string is what
 * comes back, because the kernel matches the option text it handed out.
 */
export const matchOption = (e: Escalation, decision: string): string | undefined => {
  const want = decision.trim().toLowerCase();
  return escOptions(e).find((o) => o.trim().toLowerCase() === want);
};

// `Escalation.options` is a free-form `Vec<String>` written by whoever raised the
// escalation, i.e. agent-controlled text rendered next to agent-controlled
// `decision_point` / `context_summary`. Only a recognised verb gets a decisive
// button style; anything unknown falls back to `outline` so an injected option
// (`["cancel", "wipe-workspace"]`) can never be the visually affirmative choice.
const NEGATIVE_OPTIONS = new Set(["deny", "reject", "block", "cancel", "abort", "no"]);
const AFFIRMATIVE_OPTIONS = new Set(["approve", "allow", "accept", "yes", "confirm", "ok"]);

/** "approve" → "Approve": the visible text is also the button's accessible name. */
export const optionLabel = (opt: string) => {
  const t = opt.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function optionVariant(opt: string): "destructive" | "default" | "outline" {
  const v = opt.trim().toLowerCase();
  if (NEGATIVE_OPTIONS.has(v)) return "destructive";
  return AFFIRMATIVE_OPTIONS.has(v) ? "default" : "outline";
}

/**
 * Split the selected escalations into the ones that actually offer `decision`
 * and the ones that don't. The skipped set must be surfaced and stay selected:
 * silently resolving 3 of 5 and clearing the selection reads to the operator as
 * "the other 2 were already gone" while those agents are still blocked.
 */
export function splitByOption(
  items: Escalation[],
  selected: ReadonlySet<string>,
  decision: string,
): { targets: Escalation[]; skipped: Escalation[] } {
  const chosen = items.filter((e) => selected.has(String(e.id)));
  return {
    targets: chosen.filter((e) => matchOption(e, decision) !== undefined),
    skipped: chosen.filter((e) => matchOption(e, decision) === undefined),
  };
}

/**
 * The one sentence the operator reads before an irreversible N-way decision, so
 * it has to describe the decision they actually clicked: a single hardcoded
 * "This authorises N actions" told them the exact inverse on the deny path.
 * Effect is derived from `optionVariant`, which already classifies the verb.
 */
export function bulkEffectCopy(decision: string, count: number): string {
  const actions = `${count} pending agent action${count === 1 ? "" : "s"}`;
  const variant = optionVariant(decision);
  if (variant === "destructive") return `This rejects ${actions} in one go.`;
  if (variant === "default") return `This authorises ${actions} in one go.`;
  // Unrecognised (agent-authored) verb — claim neither effect, quote the verb.
  return `This answers ${actions} with "${decision}" in one go.`;
}

export function EscalationsPage() {
  const query = useEscalations();
  const resolve = useResolveEscalation();
  const agentName = useAgentNames();
  // Per-row in-flight set so one decision only disables its own row's buttons
  // (a shared `isPending` froze the whole list); a Set because bulk-resolve
  // fires several mutations concurrently.
  const [acting, setActing] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Drop ids the server no longer returns. The kernel auto-denies pending
  // escalations after 5 minutes, so without this the sticky bar can claim
  // "3 selected" when only one of those rows still exists.
  const rows = query.data;
  useEffect(() => {
    if (!rows) return;
    const live = new Set(rows.map((e) => String(e.id)));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next; // same identity ⇒ no re-render loop
    });
  }, [rows]);

  const setRowActing = (ids: string[], on: boolean) =>
    setActing((prev) => withIds(prev, ids, on));
  const deselect = (ids: string[]) => setSelected((prev) => withIds(prev, ids, false));

  async function decide(e: Escalation, decision: string) {
    const id = String(e.id);
    setRowActing([id], true);
    try {
      await resolve.mutateAsync({ id, decision });
      toast.success(`Resolved: ${decision}`);
      // Only drop it on success — a rejected mutation must stay in the batch
      // the operator is about to retry.
      deselect([id]);
    } catch (err) {
      toastError(err);
    } finally {
      setRowActing([id], false);
    }
  }

  /** Resolve every selected escalation that supports `decision`, concurrently. */
  async function bulkDecide(items: Escalation[], decision: string) {
    const { targets, skipped } = splitByOption(items, selected, decision);
    if (targets.length === 0) {
      toast.warning(`No selected request offers "${decision}" — resolve those individually.`);
      return;
    }
    const plural = targets.length === 1 ? "" : "s";
    if (
      !(await confirm({
        title: `Resolve ${targets.length} request${plural} as "${decision}"?`,
        description:
          bulkEffectCopy(decision, targets.length) +
          (skipped.length > 0
            ? ` ${skipped.length} selected request${skipped.length === 1 ? " does" : "s do"} not offer "${decision}" and will stay selected, unresolved.`
            : ""),
        destructive: optionVariant(decision) === "destructive",
        confirmLabel: decision,
      }))
    )
      return;

    // Send each row the verb IT offered ("Approve", not our lowercased match).
    const jobs = targets.map((e) => ({ id: String(e.id), option: matchOption(e, decision) ?? decision }));
    const ids = jobs.map((j) => j.id);
    setRowActing(ids, true);
    const results = await Promise.allSettled(
      jobs.map((j) => resolve.mutateAsync({ id: j.id, decision: j.option })),
    );
    setRowActing(ids, false);
    // allSettled preserves order, so results[i] belongs to ids[i]. Clear only the
    // ids that actually resolved; failures and skips stay selected for a retry.
    const resolved = ids.filter((_, i) => results[i].status === "fulfilled");
    deselect(resolved);

    const failed = ids.length - resolved.length;
    const parts = [`${resolved.length} resolved as "${decision}"`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (skipped.length > 0) parts.push(`${skipped.length} skipped (no "${decision}" option)`);
    const message = parts.join(" · ");
    if (failed > 0 || skipped.length > 0) toast.warning(message);
    else toast.success(message);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <PageHeader title="Needs your approval" description="Actions an assistant wants to take that need your OK." />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={ShieldAlert} title="Nothing needs your approval" />}
      >
        {(items) => {
          // Group by urgency, most urgent first, for a scannable review queue.
          const groups = [...new Set(items.map((e) => e.urgency))].sort(
            (a, b) => urgencyRank(a) - urgencyRank(b),
          );
          return (
            <div className="space-y-5">
              {selected.size > 0 && (
                <div className="sticky top-0 z-10 flex items-center gap-2 rounded-md border border-border bg-background/95 p-2 shadow-sm backdrop-blur">
                  <span className="text-sm text-muted-foreground">{selected.size} selected</span>
                  {/* Disabled while any resolve is in flight — a second click would
                      re-fire the same (or a conflicting) decision for the same ids. */}
                  <Button
                    size="sm"
                    disabled={acting.size > 0}
                    onClick={() => void bulkDecide(items, "approve")}
                  >
                    Approve selected
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={acting.size > 0}
                    onClick={() => void bulkDecide(items, "deny")}
                  >
                    Deny selected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </div>
              )}
              {groups.map((urgency) => (
                <div key={urgency} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={
                        urgencyRank(urgency) === 0 ? "bg-destructive/15 text-destructive" : undefined
                      }
                    >
                      {urgency}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {items.filter((e) => e.urgency === urgency).length} pending
                    </span>
                  </div>
                  {items
                    .filter((e) => e.urgency === urgency)
                    .map((e) => (
                      <Card key={e.id}>
                        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 size-4 accent-primary"
                              aria-label={`Select ${e.decision_point}`}
                              checked={selected.has(String(e.id))}
                              onChange={() => toggleSelected(String(e.id))}
                            />
                            <div className="min-w-0">
                              <p className="font-medium">{e.decision_point}</p>
                              <p className="text-sm text-muted-foreground">{e.context_summary}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {e.agent_id && (
                                  <span title={e.agent_id}>
                                    {agentLabel(agentName(e.agent_id), e.agent_id)} ·{" "}
                                  </span>
                                )}
                                {e.blocking ? "blocking · " : ""}
                                created {relativeTime(e.created_at)} · expires{" "}
                                {relativeTime(e.expires_at)}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {escOptions(e).map((opt) => (
                              <Button
                                key={opt}
                                size="sm"
                                variant={optionVariant(opt)}
                                disabled={acting.has(String(e.id))}
                                onClick={() => decide(e, opt)}
                              >
                                {optionLabel(opt)}
                              </Button>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              ))}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}

// ── Roles ───────────────────────────────────────────────────────────────────
// Kernel permissions are `resource:flags` where flags ⊆ rwxqo.
const PERMISSION_FLAGS = [
  { flag: "r", label: "Read", desc: "Fetch specific, known content (e.g. read a file or a memory block)." },
  { flag: "w", label: "Write", desc: "Modify the resource, plus send agent-to-agent messages." },
  { flag: "x", label: "Execute", desc: "Run / invoke the resource, plus delegate and escalate." },
  { flag: "q", label: "Query", desc: "Search or look up, and create/remove event subscriptions." },
  { flag: "o", label: "Observe", desc: "Passively watch a live stream (e.g. tail the event stream)." },
] as const;
const FLAG_ORDER = "rwxqo";

// Resource classes the built-in tools check against (see agentos-tools).
const KNOWN_RESOURCES: { group: string; resources: { name: string; hint: string }[] }[] = [
  {
    group: "Files",
    resources: [
      { name: "fs.user_data", hint: "User data files" },
      { name: "fs.workspace", hint: "Agent workspace files" },
      { name: "fs.data", hint: "Shared data directory" },
      { name: "fs.logs", hint: "Log files" },
    ],
  },
  {
    group: "Memory",
    resources: [
      { name: "memory.semantic", hint: "Semantic / archival memory" },
      { name: "memory.episodic", hint: "Episodic memory" },
      { name: "memory.procedural", hint: "Procedural memory" },
      { name: "memory.context", hint: "Context blocks" },
    ],
  },
  {
    group: "Network & processes",
    resources: [
      { name: "network.outbound", hint: "Outbound network calls" },
      { name: "process.exec", hint: "Run system processes" },
    ],
  },
  {
    group: "Agents & tasks",
    resources: [
      { name: "agent.spawn", hint: "Spawn sub-agents" },
      { name: "agent.registry", hint: "Look up registered agents" },
      { name: "task.query", hint: "Inspect tasks" },
      { name: "schedule.job", hint: "Scheduled jobs" },
      { name: "schedule.timer", hint: "Timers" },
    ],
  },
  {
    group: "Events & system",
    resources: [
      { name: "events.stream", hint: "Subscribe to the event stream" },
      { name: "escalation.query", hint: "Inspect escalations" },
      { name: "user.notify", hint: "Notify the user" },
      { name: "scratchpad", hint: "Shared scratchpad" },
    ],
  },
];

const KNOWN_RESOURCE_NAMES = new Set(KNOWN_RESOURCES.flatMap((g) => g.resources.map((r) => r.name)));

function sortFlags(flags: string): string {
  return FLAG_ORDER.split("").filter((f) => flags.includes(f)).join("");
}

function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="sticky top-0 border-b border-border bg-muted/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
      {children}
    </p>
  );
}

function ResourceRow({
  name,
  hint,
  flags,
  onToggle,
}: {
  name: string;
  hint?: string;
  flags: string;
  onToggle: (flag: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs">{name}</p>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 gap-1">
        {PERMISSION_FLAGS.map(({ flag, label }) => (
          <button
            key={flag}
            type="button"
            title={label}
            aria-label={`${label} — ${name}`}
            aria-pressed={flags.includes(flag)}
            onClick={() => onToggle(flag)}
            className={cn(
              "size-6 rounded font-mono text-xs uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              flags.includes(flag)
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {flag}
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateRoleDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  // resource -> selected flags (e.g. { "fs.user_data": "rw" })
  const [perms, setPerms] = useState<Record<string, string>>({});
  const [customResources, setCustomResources] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const roles = useRoles();
  const create = useCreateRole();

  // Resources outside the built-in catalog: used by existing roles, added via the
  // custom input, or already selected (so a row never vanishes mid-edit on refetch).
  const extraResources = useMemo(() => {
    const extra = new Set(customResources);
    for (const role of roles.data ?? []) {
      for (const p of role.permissions) {
        const resource = p.split(":")[0];
        if (resource && !KNOWN_RESOURCE_NAMES.has(resource)) extra.add(resource);
      }
    }
    for (const [resource, flags] of Object.entries(perms)) {
      if (flags && !KNOWN_RESOURCE_NAMES.has(resource)) extra.add(resource);
    }
    return [...extra].sort();
  }, [roles.data, customResources, perms]);

  const selected = Object.entries(perms)
    .filter(([, flags]) => flags.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  function toggleFlag(resource: string, flag: string) {
    setPerms((prev) => {
      const current = prev[resource] ?? "";
      const next = current.includes(flag) ? current.replace(flag, "") : sortFlags(current + flag);
      return { ...prev, [resource]: next };
    });
  }

  function addCustomResource() {
    const resource = customInput.trim();
    if (!resource) return;
    if (resource.includes(":") || /\s/.test(resource)) {
      toast.error("Resource names can't contain spaces or ':' — flags are picked below.");
      return;
    }
    if (!KNOWN_RESOURCE_NAMES.has(resource) && !customResources.includes(resource)) {
      setCustomResources((prev) => [...prev, resource]);
    }
    setPerms((prev) => ({ ...prev, [resource]: prev[resource] || "r" }));
    setCustomInput("");
  }

  function reset() {
    setName("");
    setDesc("");
    setPerms({});
    setCustomResources([]);
    setCustomInput("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: desc.trim() || undefined,
        permissions: selected.map(([resource, flags]) => `${resource}:${flags}`),
      });
      toast.success("Role created");
      setOpen(false);
      reset();
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>New role</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create role</DialogTitle>
          <DialogDescription>
            Pick the resources this role may touch and toggle the access flags: read, write,
            execute, query, observe.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" />
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Info className="size-3.5 text-muted-foreground" />
              What the access flags mean
            </div>
            <dl className="mt-2 grid gap-1.5">
              {PERMISSION_FLAGS.map(({ flag, label, desc: flagDesc }) => (
                <div key={flag} className="flex items-baseline gap-2 text-xs">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted font-mono uppercase text-muted-foreground">
                    {flag}
                  </span>
                  <dt className="shrink-0 font-medium">{label}</dt>
                  <dd className="text-muted-foreground">{flagDesc}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              An empty role grants nothing — agents holding it can only do what other roles allow.
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {KNOWN_RESOURCES.map(({ group, resources }) => (
              <div key={group}>
                <GroupHeader>{group}</GroupHeader>
                {resources.map((r) => (
                  <ResourceRow
                    key={r.name}
                    name={r.name}
                    hint={r.hint}
                    flags={perms[r.name] ?? ""}
                    onToggle={(flag) => toggleFlag(r.name, flag)}
                  />
                ))}
              </div>
            ))}
            {extraResources.length > 0 && (
              <div>
                <GroupHeader>Other resources</GroupHeader>
                {extraResources.map((r) => (
                  <ResourceRow key={r} name={r} flags={perms[r] ?? ""} onToggle={(flag) => toggleFlag(r, flag)} />
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomResource();
                }
              }}
              placeholder="Custom resource (e.g. fs.exports)"
              aria-label="Custom resource name"
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={addCustomResource} disabled={!customInput.trim()}>
              Add
            </Button>
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.map(([resource, flags]) => (
                <Badge key={resource} variant="muted" className="font-mono">
                  {resource}:{flags}
                </Badge>
              ))}
            </div>
          )}
          <DialogFooter className="items-center">
            <span className="mr-auto text-xs text-muted-foreground">
              {selected.length} permission{selected.length === 1 ? "" : "s"} selected
            </span>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RolesPage() {
  const query = useRoles();
  const del = useDeleteRole();
  async function onDelete(name: string) {
    if (!(await confirm({ title: `Delete role ${name}?`, destructive: true, confirmLabel: "Delete" }))) return;
    try {
      await del.mutateAsync(name);
      toast.success("Role deleted");
    } catch (e) {
      toastError(e);
    }
  }
  const columns: Column<Role>[] = [
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "desc", header: "Description", cell: (r) => <span className="text-muted-foreground">{r.description ?? "—"}</span> },
    {
      key: "perms",
      header: "Permissions",
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.permissions.slice(0, 6).map((p) => (
            <Badge key={p} variant="muted">
              {p}
            </Badge>
          ))}
          {r.permissions.length > 6 && <Badge variant="muted">+{r.permissions.length - 6}</Badge>}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => onDelete(r.name)}>
          Delete
        </Button>
      ),
    },
  ];
  return (
    <div>
      <PageHeader title="Permission sets" description="Named bundles of permissions you can give an assistant." actions={<CreateRoleDialog />} />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={KeyRound} title="No permission sets" action={<CreateRoleDialog />} />}
      >
        {(roles) => <DataTable columns={columns} rows={roles} getRowId={(r) => r.name} />}
      </QueryState>
    </div>
  );
}

// ── Preferences (adaptation proposals) ──────────────────────────────────────
export function PreferencesPage() {
  const proposals = usePrefProposals();
  const stats = usePrefStats();
  const accept = useReviewProposal("accept");
  const reject = useReviewProposal("reject");
  // Per-row in-flight set: guards against a double-click firing two POSTs, and
  // (unlike a shared `isPending`) only disables the row being reviewed.
  const [reviewing, setReviewing] = useState<ReadonlySet<string>>(new Set());
  async function review(p: PrefProposal, action: "accept" | "reject") {
    const id = String(p.id);
    if (reviewing.has(id)) return;
    const m = action === "accept" ? accept : reject;
    setReviewing((prev) => withIds(prev, [id], true));
    try {
      await m.mutateAsync(id);
      toast.success(action === "accept" ? "Preference kept" : "Proposal dismissed");
    } catch (e) {
      toastError(e);
    } finally {
      setReviewing((prev) => withIds(prev, [id], false));
    }
  }
  return (
    <div>
      <PageHeader title="What I've learned about you" description="Things assistants noticed about how you work — approve to keep, dismiss to forget." />
      {stats.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ["Proposed", stats.data.proposed],
              ["Pending", stats.data.pending],
              ["Accepted", stats.data.accepted],
              ["Rejected", stats.data.rejected],
              ["Expired", stats.data.expired],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-md border border-border p-3">
              <p className="text-xl font-semibold">{v}</p>
              <p className="text-xs text-muted-foreground">{k}</p>
            </div>
          ))}
        </div>
      )}
      <QueryState
        query={proposals}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={SlidersHorizontal} title="No proposals" />}
      >
        {(items) => (
          <div className="space-y-2">
            {items.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Badge variant="muted">{p.kind}</Badge>
                      <StatusBadge status={p.status} />
                      <span className="text-xs text-muted-foreground">
                        confidence {Math.round((p.confidence ?? 0) * 100)}%
                      </span>
                    </span>
                    <p className="mt-1 text-sm">{p.content}</p>
                  </div>
                  {p.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={reviewing.has(String(p.id))}
                        onClick={() => review(p, "accept")}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reviewing.has(String(p.id))}
                        onClick={() => review(p, "reject")}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ── Audit ───────────────────────────────────────────────────────────────────
function VerifyChainButton() {
  const verify = useVerifyAudit();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={verify.isPending}
      onClick={() =>
        verify
          .mutateAsync()
          .then((r) =>
            r.valid && r.gaps
              ? toast.warning(
                  `Chain intact — ${r.entries_checked ?? "?"} entries verified across ${r.gaps + 1} segments (${r.gaps} gaps from rotation/cleanup; deletions inside a gap are not detectable)`,
                )
              : r.valid
                ? toast.success(`Chain intact — ${r.entries_checked ?? "?"} entries verified`)
              : toast.error(
                  `Chain BROKEN at seq ${r.first_invalid_seq ?? "?"} (${r.entries_checked ?? "?"} checked)`,
                ),
          )
          .catch(toastError)
      }
    >
      {verify.isPending ? "Verifying…" : "Verify chain"}
    </Button>
  );
}

function TraceLookup() {
  const [input, setInput] = useState("");
  const [traceId, setTraceId] = useState("");
  const trace = useAuditTrace(traceId);
  const agentName = useAgentNames();
  return (
    <div className="mb-4 space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTraceId(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Look up a trace ID (from a task trace or log line)…"
          className="max-w-md font-mono text-xs"
        />
        <Button type="submit" variant="outline" size="sm" disabled={!input.trim()}>
          Look up
        </Button>
      </form>
      {traceId.trim() && (
        <QueryState query={trace}>
          {(d) => (
            <Card>
              <CardContent className="space-y-1 p-4 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{d.event_type}</Badge>
                  <span className="text-xs text-muted-foreground">{relativeTime(d.timestamp)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.agent_id && (
                    <span title={d.agent_id}>
                      agent {agentLabel(agentName(d.agent_id), d.agent_id)} ·{" "}
                    </span>
                  )}
                  {d.task_id ? `task ${d.task_id} · ` : ""}
                  trace <code>{d.trace_id}</code>
                </p>
                {d.details && <p className="whitespace-pre-wrap text-sm">{d.details}</p>}
                {d.metadata != null && (
                  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(d.metadata, null, 2)}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}
        </QueryState>
      )}
    </div>
  );
}

export function AuditPage() {
  const query = useAuditLogs();
  return (
    <div>
      <PageHeader
        title="Audit"
        description="Append-only audit trail."
        actions={<VerifyChainButton />}
      />
      <TraceLookup />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={ScrollText} title="No audit entries" />}
      >
        {(items) => (
          <div className="rounded-lg border border-border px-3">
            <AuditRows entries={items} />
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ── Standing grants (approval policies) ──────────────────────────────────────
// Persisted "allow always" overrides: for a tool (optionally scoped to a payload
// path glob and/or one agent), the approval hook lifts Prompt→Allow instead of
// escalating. `expires_at` gives a time-boxed grant swept by the kernel.
const GRANT_TTLS: { label: string; hours: number | null }[] = [
  { label: "1 hour", hours: 1 },
  { label: "8 hours", hours: 8 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "Never", hours: null },
];

/** Sentinel for the deliberate "every agent" scope — the API models it as an absent `agent_id`. */
const ALL_AGENTS = "*";

/**
 * Blast-radius warning for a standing grant, or `null` when it is narrow enough
 * to add without a hard stop. An unscoped policy (`agent_id: None`) matches
 * EVERY agent, present and future (`approval_policy_store.rs`), and one with no
 * `expires_at` is never swept — either alone lifts the tool from Prompt to Allow
 * outside the escalation queue, so neither may be a two-click accident.
 */
export function grantWarning(tool: string, allAgents: boolean, never: boolean): string | null {
  if (!allAgents && !never) return null;
  const who = allAgents ? "every agent, including ones connected later" : "this agent";
  const when = never ? "forever (nothing expires it)" : "until the grant expires";
  return `${tool || "This tool"} calls will be auto-approved for ${who}, ${when}, skipping your approval queue entirely.`;
}

/**
 * Request body for a standing grant. Extracted from the dialog for one
 * security-load-bearing line: `ALL_AGENTS` is a UI-only sentinel and the API
 * models "every agent" as an ABSENT `agent_id`, so `"*"` must never go on the
 * wire as a literal agent id — a policy stored against the agent named `"*"`
 * matches nothing, and the operator is told it applies to everyone.
 */
export function buildGrantBody(
  tool: string,
  scope: string,
  pathGlob: string,
  ttlHours: number | null,
): AddApprovalPolicyBody {
  return {
    tool_name: tool.trim(),
    agent_id: scope === ALL_AGENTS ? undefined : scope,
    path_glob: pathGlob.trim() || undefined,
    // Expiry is computed client-side; the API accepts an RFC3339 timestamp.
    expires_at:
      ttlHours == null ? undefined : new Date(Date.now() + ttlHours * 3600_000).toISOString(),
  };
}

function AddGrantDialog() {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState("");
  const [pathGlob, setPathGlob] = useState("");
  const [agentId, setAgentId] = useState("");
  const [ttlHours, setTtlHours] = useState<number | null>(24);
  const agents = useAgents();
  const add = useAddApprovalPolicy();

  // No default scope. Falling back to `agents.data[0]` pinned a security grant
  // to whatever the server happened to list first (the hook does no sorting) —
  // two clicks, an agent the operator never chose. Submit stays disabled until
  // the scope is picked explicitly.
  const scope = agentId;
  const allAgents = scope === ALL_AGENTS;
  // A failed agents query is not "no agents connected": saying so, with the
  // every-agent scope still on offer, nudges the operator to the widest grant
  // as the only thing they can pick. Say it failed, and offer nothing.
  const agentPlaceholder = agents.isLoading
    ? "Loading agents…"
    : agents.isError
      ? "Couldn't load agents — reload to retry"
      : agents.data?.length
        ? "Select an agent…"
        : "No agents connected";
  const warning = grantWarning(tool.trim(), allAgents, ttlHours == null);

  function reset() {
    setTool("");
    setPathGlob("");
    setAgentId("");
    setTtlHours(24);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!tool.trim() || !scope) return;
    if (
      warning &&
      !(await confirm({
        title: allAgents
          ? `Always allow "${tool.trim()}" for EVERY agent?`
          : `Always allow "${tool.trim()}" with no expiry?`,
        description: warning,
        destructive: true,
        confirmLabel: "Add grant",
      }))
    )
      return;
    try {
      await add.mutateAsync(buildGrantBody(tool, scope, pathGlob, ttlHours));
      toast.success("Standing grant added");
      reset();
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Add grant</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New standing grant</DialogTitle>
            <DialogDescription>
              Auto-approve a tool so matching calls stop escalating until the grant expires.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Tool name</label>
              <Input
                value={tool}
                onChange={(e) => setTool(e.target.value)}
                placeholder="e.g. shell-exec"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="grant-agent">
                Applies to
              </label>
              <Select
                id="grant-agent"
                value={scope}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={agents.isLoading || agents.isError}
              >
                <option value="">{agentPlaceholder}</option>
                {(agents.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.model})
                  </option>
                ))}
                {!agents.isError && (
                  <option value={ALL_AGENTS}>⚠ All agents — every agent, present and future</option>
                )}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Path glob (optional)</label>
              <Input
                value={pathGlob}
                onChange={(e) => setPathGlob(e.target.value)}
                placeholder="e.g. /tmp/**"
              />
              <p className="text-xs text-muted-foreground">
                Scope to a payload <code>path</code>; leave blank to match any.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Expires</label>
              <div className="flex flex-wrap gap-1.5">
                {GRANT_TTLS.map((t) => (
                  <Button
                    key={t.label}
                    type="button"
                    size="sm"
                    variant={ttlHours === t.hours ? "default" : "outline"}
                    onClick={() => setTtlHours(t.hours)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>
            {warning && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {warning}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={add.isPending || !tool.trim() || !scope}>
              {add.isPending ? "Adding…" : "Add grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StandingGrantsPage() {
  const query = useApprovalPolicies();
  const revoke = useRevokeApprovalPolicy();
  const canWrite = useAuthStore((s) => s.can("approvals:w"));
  const agentName = useAgentNames();
  // Per-row in-flight set — `revoke.isPending` disabled Revoke on every grant.
  const [revoking, setRevoking] = useState<ReadonlySet<number>>(new Set());
  async function onRevoke(p: ApprovalPolicy) {
    // Name the target: two grants can differ only by `path_glob`, and the list
    // can reorder between the click and the confirmation.
    const target = p.path_glob ? `${p.tool_name} (${p.path_glob})` : p.tool_name;
    if (
      !(await confirm({
        title: `Revoke grant for "${target}"?`,
        // Name the scope: "this agent" is ambiguous next to a truncated id, and
        // an unscoped grant (no agent_id) is the wider, more dangerous one.
        description: `Matching calls from ${p.agent_id ? `agent ${agentLabel(agentName(p.agent_id), p.agent_id)}` : "every agent"} will go back to needing your approval.`,
        destructive: true,
        confirmLabel: "Revoke",
      }))
    )
      return;
    setRevoking((prev) => withIds(prev, [p.id], true));
    try {
      await revoke.mutateAsync(p.id);
      toast.success(`Revoked ${p.tool_name}`);
    } catch (e) {
      toastError(e);
    } finally {
      setRevoking((prev) => withIds(prev, [p.id], false));
    }
  }
  return (
    <div>
      <PageHeader
        title="Always allow"
        description="Persisted allow-always approvals — tool calls matching a grant skip the escalation queue until it expires."
        actions={canWrite ? <AddGrantDialog /> : null}
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={ShieldAlert} title="No standing grants" />}
      >
        {(items) => (
          <div className="space-y-2">
            {items.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <code>{p.tool_name}</code>
                      {p.path_glob ? <span className="text-muted-foreground"> · {p.path_glob}</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.agent_id ? (
                        <span title={p.agent_id}>
                          agent {agentLabel(agentName(p.agent_id), p.agent_id)} ·{" "}
                        </span>
                      ) : (
                        "all agents · "
                      )}
                      granted {relativeTime(p.granted_at)} by {p.granted_by}
                      {p.expires_at ? ` · expires ${relativeTime(p.expires_at)}` : " · never expires"}
                    </p>
                  </div>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoking.has(p.id)}
                      onClick={() => onRevoke(p)}
                    >
                      Revoke
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ── Notifications (operator inbox) ───────────────────────────────────────────
/** Who sent it: the agent's name for `Agent <uuid>` labels, else the label as-is. */
function useSenderLabel() {
  const agentName = useAgentNames();
  return (from: string | null | undefined) => {
    const id = senderAgentId(from);
    return id ? agentLabel(agentName(id), id) : from || "";
  };
}

function RespondDialog({
  target,
  onOpenChange,
}: {
  target: NotificationSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const respond = useRespondNotification();
  const sender = useSenderLabel();
  const id = target?.id ?? null;
  useEffect(() => setText(""), [id]);
  return (
    <Dialog open={id != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Respond</DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                Reply to <span title={senderAgentId(target.from) ?? undefined}>{sender(target.from) || "the sender"}</span>{" "}
                about “{target.subject}”.
              </>
            ) : (
              "Reply to this notification."
            )}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Response…"
          autoFocus
        />
        <DialogFooter>
          <Button
            disabled={respond.isPending || !text.trim() || !id}
            onClick={() =>
              respond
                .mutateAsync({ id: id!, text: text.trim() })
                .then(() => {
                  toast.success("Responded");
                  onOpenChange(false);
                })
                .catch(toastError)
            }
          >
            {respond.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NotificationsPage() {
  const query = useNotifications();
  const dismiss = useDismissNotification();
  const clearRead = useClearReadNotifications();
  const [respondTo, setRespondTo] = useState<NotificationSummary | null>(null);
  const sender = useSenderLabel();
  // Per-row in-flight set — `dismiss.isPending` disabled Dismiss on every row.
  const [dismissing, setDismissing] = useState<ReadonlySet<string>>(new Set());

  async function onDismiss(id: string) {
    setDismissing((prev) => withIds(prev, [id], true));
    try {
      await dismiss.mutateAsync(id);
      toast.success("Dismissed");
    } catch (e) {
      toastError(e);
    } finally {
      setDismissing((prev) => withIds(prev, [id], false));
    }
  }

  async function onClearRead() {
    // Bulk delete with no undo — confirm before it runs.
    if (
      !(await confirm({
        title: "Clear read notifications?",
        description: "Deletes every notification you have already read. This cannot be undone.",
        destructive: true,
        confirmLabel: "Clear read",
      }))
    )
      return;
    try {
      await clearRead.mutateAsync();
      toast.success("Read notifications cleared");
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Operator inbox — agent questions, alerts, and channel messages."
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={clearRead.isPending}
            onClick={() => void onClearRead()}
          >
            Clear read
          </Button>
        }
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Info} title="No notifications" />}
      >
        {(items) => (
          <div className="space-y-2">
            {items.map((n) => (
              <Card key={n.id} className={n.read ? "opacity-70" : undefined}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{n.subject}</p>
                      {!n.read && <Badge variant="secondary">new</Badge>}
                      {n.priority && n.priority !== "normal" && (
                        <Badge
                          variant="secondary"
                          className={
                            n.priority === "critical" || n.priority === "high"
                              ? "bg-destructive/15 text-destructive"
                              : undefined
                          }
                        >
                          {n.priority}
                        </Badge>
                      )}
                    </div>
                    {n.body && <Markdown className="mt-1 text-sm text-muted-foreground">{n.body}</Markdown>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.from && (
                        <span title={senderAgentId(n.from) ?? undefined}>from {sender(n.from)} · </span>
                      )}
                      {relativeTime(n.timestamp)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setRespondTo(n)}>
                      Respond
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={dismissing.has(n.id)}
                      onClick={() => void onDismiss(n.id)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
      <RespondDialog target={respondTo} onOpenChange={(o) => !o && setRespondTo(null)} />
    </div>
  );
}
