import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { FolderOpen, NotebookPen, Lock, DollarSign, FileText } from "lucide-react";
import {
  useFiles,
  useDeleteFile,
  useUploadFile,
  useScratchpad,
  useScratchPage,
  useSaveScratchPage,
  useSecrets,
  useSetSecret,
  useDeleteSecret,
  useCosts,
  useConfig,
  useSetConfig,
  useDoctor,
  useDoctorFix,
  useLogs,
  useResources,
} from "@/api/queries/system";
import { useAuthStore } from "@/auth/store";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { bytes, relativeTime, usd, tokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileMeta, CostSummaryEntry } from "@/api/models";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function downloadFile(id: string, name: string) {
  const key = useAuthStore.getState().apiKey;
  const res = await fetch(`${API_BASE}/api/v1/files/${id}/download`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) {
    toast.error("Download failed");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function UploadButton() {
  const upload = useUploadFile();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutateAsync(f).then(() => toast.success("Uploaded")).catch(toastError);
          e.target.value = "";
        }}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
        {upload.isPending ? "Uploading…" : "Upload"}
      </Button>
    </>
  );
}

export function FilesPage() {
  const query = useFiles();
  const del = useDeleteFile();
  async function onDelete(id: string) {
    if (!(await confirm({ title: "Delete file?", destructive: true, confirmLabel: "Delete" }))) return;
    del.mutateAsync(id).then(() => toast.success("Deleted")).catch(toastError);
  }
  const columns: Column<FileMeta>[] = [
    { key: "name", header: "Name", cell: (f) => <span className="font-medium">{f.original_name || f.name}</span> },
    { key: "mime", header: "Type", cell: (f) => <span className="text-xs text-muted-foreground">{f.mime}</span> },
    { key: "size", header: "Size", cell: (f) => <span className="text-muted-foreground">{bytes(f.size)}</span> },
    { key: "scope", header: "Scope", cell: (f) => <Badge variant="muted">{f.scope}</Badge> },
    { key: "uploaded", header: "Uploaded", cell: (f) => <span className="text-muted-foreground">{relativeTime(f.uploaded_at)}</span> },
    {
      key: "actions",
      header: "",
      cell: (f) => (
        <span className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => downloadFile(f.id, f.original_name || f.name)}>
            Download
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(f.id)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Files"
        description="Uploaded and agent-generated files."
        actions={<UploadButton />}
      />
      <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={FolderOpen} title="No files" />}>
        {(data) => <DataTable columns={columns} rows={data.items} getRowId={(f) => f.id} />}
      </QueryState>
    </div>
  );
}

function ScratchEditDialog({
  page,
  onOpenChange,
}: {
  page: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = page != null;
  const detail = useScratchPage(page ?? "", open);
  const save = useSaveScratchPage();
  const [content, setContent] = useState("");
  // Clear the editor immediately when the target page changes so the previous
  // page's text can never be shown/saved against the new page while it loads.
  useEffect(() => {
    setContent("");
  }, [page]);
  useEffect(() => {
    if (detail.data) setContent(detail.data.content);
  }, [detail.data]);
  const loaded = Boolean(detail.data);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{page}</DialogTitle>
        </DialogHeader>
        {detail.isPending || !loaded ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[320px] font-mono text-xs"
          />
        )}
        <DialogFooter>
          <Button
            disabled={save.isPending || !page || !loaded}
            onClick={() =>
              save
                .mutateAsync({ page: page!, content })
                .then(() => {
                  toast.success("Saved");
                  onOpenChange(false);
                })
                .catch(toastError)
            }
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScratchpadPage() {
  const query = useScratchpad();
  const [editPage, setEditPage] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title="Scratchpad" description="Agent working-memory pages." />
      <QueryState query={query} isEmpty={(d) => d.pages.length === 0} empty={<EmptyState icon={NotebookPen} title="No pages" />}>
        {(data) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.pages.map((p) => (
              <button key={p.id} className="text-left" onClick={() => setEditPage(p.title)}>
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="p-4">
                    <p className="font-medium">{p.title}</p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {p.tags.map((t) => (
                        <Badge key={t} variant="muted">{t}</Badge>
                      ))}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">updated {relativeTime(p.updated_at)}</p>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
      </QueryState>
      <ScratchEditDialog page={editPage} onOpenChange={(o) => !o && setEditPage(null)} />
    </div>
  );
}

function SetSecretDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const set = useSetSecret();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await set.mutateAsync({ name: name.trim(), value });
      toast.success("Secret saved");
      setOpen(false);
      setName("");
      setValue("");
    } catch (err) {
      toastError(err);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New secret</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set secret</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" required />
          <DialogFooter>
            <Button type="submit" disabled={set.isPending || !name.trim() || !value}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Secret scope is an enum that serializes as a string (`"Global"`) or a
 *  single-key object (`{ Agent: "<id>" }` / `{ Tool: "<name>" }`). */
function formatScope(scope: unknown): string {
  if (typeof scope === "string") return scope;
  if (scope && typeof scope === "object") {
    const [k, v] = Object.entries(scope as Record<string, unknown>)[0] ?? [];
    return k ? `${k}: ${String(v)}` : "";
  }
  return "";
}

export function SecretsPage() {
  const query = useSecrets();
  const del = useDeleteSecret();
  async function onDelete(name: string) {
    if (!(await confirm({ title: `Delete secret ${name}?`, destructive: true, confirmLabel: "Delete" }))) return;
    del.mutateAsync(name).then(() => toast.success("Deleted")).catch(toastError);
  }
  return (
    <div>
      <PageHeader title="Secrets" description="Encrypted vault entries (values never shown)." actions={<SetSecretDialog />} />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Lock} title="No secrets" action={<SetSecretDialog />} />}>
        {(items) => (
          <div className="rounded-lg border border-border divide-y divide-border">
            {items.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <Lock className="size-3.5 text-muted-foreground" />
                  <code>{s.name}</code>
                  {s.scope != null && <Badge variant="muted">{formatScope(s.scope)}</Badge>}
                </span>
                {s.name && (
                  <Button variant="ghost" size="sm" onClick={() => onDelete(s.name as string)}>Delete</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

export function CostsPage() {
  const query = useCosts();
  const columns: Column<CostSummaryEntry>[] = [
    { key: "agent", header: "Agent", cell: (c) => <span className="font-medium">{c.agent_name}</span> },
    { key: "cost", header: "Cost", cell: (c) => usd(c.cost_usd) },
    { key: "budget", header: "Budget/day", cell: (c) => <span className="text-muted-foreground">{c.budget?.max_cost_usd_per_day != null ? usd(c.budget.max_cost_usd_per_day) : "—"}</span> },
    { key: "pct", header: "Used", cell: (c) => <span>{c.cost_pct != null ? `${Math.round(c.cost_pct)}%` : "—"}</span> },
    { key: "tokens", header: "Tokens", cell: (c) => <span className="text-muted-foreground">{tokens(c.tokens_used)}</span> },
  ];
  return (
    <div>
      <PageHeader title="Costs" description="Per-agent spend and budgets." />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={DollarSign} title="No cost data" />}>
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(c) => c.agent_id ?? c.agent_name} />}
      </QueryState>
    </div>
  );
}

export function ConfigPage() {
  const query = useConfig();
  const setCfg = useSetConfig();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  async function onSet(e: FormEvent) {
    e.preventDefault();
    try {
      await setCfg.mutateAsync({ key: key.trim(), value });
      toast.success("Config updated");
      setKey("");
      setValue("");
    } catch (err) {
      toastError(err);
    }
  }
  return (
    <div>
      <PageHeader
        title="Config"
        description="Live kernel configuration. Writes require [api] config_writable = true."
      />
      <form onSubmit={onSet} className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="dotted.key (e.g. kernel.max_concurrent_tasks)"
          className="max-w-xs"
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value"
          className="max-w-xs"
        />
        <Button type="submit" disabled={setCfg.isPending || !key.trim()}>
          {setCfg.isPending ? "Setting…" : "Set"}
        </Button>
      </form>
      <QueryState query={query}>
        {(tree) => (
          <pre className="overflow-auto rounded-lg border border-border bg-muted p-4 text-xs">
            {JSON.stringify(tree.config, null, 2)}
          </pre>
        )}
      </QueryState>
    </div>
  );
}

export function DoctorPage() {
  const query = useDoctor();
  const fix = useDoctorFix();
  return (
    <div>
      <PageHeader
        title="Doctor"
        description="Configuration and environment diagnostics."
        actions={
          <Button onClick={() => fix.mutateAsync().then(() => toast.success("Ran fixes")).catch(toastError)} disabled={fix.isPending}>
            {fix.isPending ? "Fixing…" : "Auto-fix"}
          </Button>
        }
      />
      <QueryState query={query}>
        {(report) => (
          <div className="space-y-2">
            <div className={cn("rounded-md p-3 text-sm", report.all_ok ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
              {report.all_ok ? "All checks passing." : "Some checks need attention."}
            </div>
            <div className="rounded-lg border border-border divide-y divide-border">
              {report.checks.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-muted-foreground">{c.detail}</span>
                  </span>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}

const SEV_COLOR: Record<string, string> = {
  error: "text-destructive",
  warn: "text-warning",
  warning: "text-warning",
  info: "text-foreground",
  debug: "text-muted-foreground",
};

export function LogsPage() {
  const query = useLogs();
  return (
    <div>
      <PageHeader title="Logs" description="Recent kernel log lines." />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={FileText} title="No logs" />}>
        {(lines) => (
          <pre className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-muted p-3 text-xs leading-relaxed">
            {lines.map((l, i) => (
              <div key={i}>
                <span className="text-muted-foreground">{l.timestamp?.slice(11, 19)} </span>
                <span className={cn("font-semibold", SEV_COLOR[l.severity?.toLowerCase()] ?? "text-foreground")}>
                  {l.severity?.toUpperCase()}{" "}
                </span>
                <span>{l.line}</span>
              </div>
            ))}
          </pre>
        )}
      </QueryState>
    </div>
  );
}

export function ResourcesPage() {
  const query = useResources();
  return (
    <div>
      <PageHeader title="Resources" description="Host memory, disk, and resource locks." />
      <QueryState query={query}>
        {(r) => (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Memory</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    {Math.round(r.mem_used_mb)} / {Math.round(r.mem_total_mb)} MB
                  </p>
                  <p className="text-xs text-muted-foreground">used / total</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Disk</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    {bytes(r.disk_free_bytes)} free
                  </p>
                  <p className="text-xs text-muted-foreground">of {bytes(r.disk_total_bytes)} · {r.data_dir}</p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Resource locks</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {Array.isArray(r.locks) ? `${r.locks.length} active lock(s)` : "—"}
                  {r.contention ? ` · contention: ${String(r.contention)}` : ""}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}
