import { useMemo, useState, type FormEvent } from "react";
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
} from "@/api/queries/governance";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { EventLogItem } from "@/components/event-log";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import type { Escalation, Role, PrefProposal } from "@/api/models";

// ── Escalations ─────────────────────────────────────────────────────────────

/** Group order for the review queue — most urgent first, unknown urgencies last. */
const URGENCY_ORDER = ["critical", "high", "normal", "low"];
const urgencyRank = (u: string) => {
  const i = URGENCY_ORDER.indexOf(u.toLowerCase());
  return i === -1 ? URGENCY_ORDER.length : i;
};

const escOptions = (e: Escalation) => e.options ?? ["approve", "deny"];

export function EscalationsPage() {
  const query = useEscalations();
  const resolve = useResolveEscalation();
  // Per-row in-flight set so one decision only disables its own row's buttons
  // (a shared `isPending` froze the whole list); a Set because bulk-resolve
  // fires several mutations concurrently.
  const [acting, setActing] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  function setRowActing(ids: string[], on: boolean) {
    setActing((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function decide(e: Escalation, decision: string) {
    const id = String(e.id);
    setRowActing([id], true);
    try {
      await resolve.mutateAsync({ id, decision });
      toast.success(`Resolved: ${decision}`);
    } catch (err) {
      toastError(err);
    } finally {
      setRowActing([id], false);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  /** Resolve every selected escalation that supports `decision`, concurrently. */
  async function bulkDecide(items: Escalation[], decision: string) {
    const targets = items.filter(
      (e) => selected.has(String(e.id)) && escOptions(e).includes(decision),
    );
    if (targets.length === 0) return;
    const ids = targets.map((e) => String(e.id));
    setRowActing(ids, true);
    const results = await Promise.allSettled(
      targets.map((e) => resolve.mutateAsync({ id: String(e.id), decision })),
    );
    setRowActing(ids, false);
    setSelected(new Set());
    const failed = results.filter((r) => r.status === "rejected").length;
    const past = decision === "deny" ? "denied" : `${decision}d`;
    if (failed === 0) toast.success(`${results.length} ${past}`);
    else toast.warning(`${results.length - failed} ${past}, ${failed} failed`);
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
      <PageHeader title="Escalations" description="Human-approval requests from agents." />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={ShieldAlert} title="No pending escalations" />}
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
                                {e.agent_id ? `${e.agent_id} · ` : ""}
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
                                variant={opt === "deny" ? "destructive" : "default"}
                                disabled={acting.has(String(e.id))}
                                onClick={() => decide(e, opt)}
                              >
                                {opt}
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
      <PageHeader title="Roles" description="OS roles and their permission sets." actions={<CreateRoleDialog />} />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={KeyRound} title="No roles" action={<CreateRoleDialog />} />}
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
  async function review(p: PrefProposal, action: "accept" | "reject") {
    const m = action === "accept" ? accept : reject;
    try {
      await m.mutateAsync(String(p.id));
    } catch (e) {
      toastError(e);
    }
  }
  return (
    <div>
      <PageHeader title="Preferences" description="Learned user-adaptation proposals to review." />
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
                      <Button size="sm" onClick={() => review(p, "accept")}>
                        Accept
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => review(p, "reject")}>
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
export function AuditPage() {
  const query = useAuditLogs();
  return (
    <div>
      <PageHeader title="Audit" description="Append-only audit trail." />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={ScrollText} title="No audit entries" />}
      >
        {(items) => (
          <div className="divide-y divide-border rounded-lg border border-border px-3">
            {items.map((e, i) => (
              <EventLogItem key={i} entry={e} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
