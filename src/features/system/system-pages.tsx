import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { FolderOpen, NotebookPen, Lock, DollarSign, FileText, Copy, AtSign, KeySquare, Cpu, Sliders } from "lucide-react";
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
  useSystemStatus,
  useHal,
  useDeleteScratchPage,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/api/queries/system";
import { authedFetch } from "@/api/client";
import { useAuthStore } from "@/auth/store";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilePreview, FileThumb } from "@/components/file-preview";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { toastError } from "@/lib/errors";
import {
  bytes,
  relativeTime,
  usd,
  tokens,
  humanizeKey,
  flattenConfig,
  configValue,
  type ConfigLeaf,
} from "@/lib/format";
import { useAgentNames, agentLabel } from "@/lib/agent-names";
import { cn } from "@/lib/utils";
import { configHint, configKeyHint, configSectionHint } from "./config-hints";
import type { FileMeta, CostSummaryEntry } from "@/api/models";
import { copyText } from "@/lib/clipboard";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Callout } from "@/components/ui/callout";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/** Throws on any failure — every call site must `.catch(toastError)`. */
async function downloadFile(id: string, name: string) {
  // `timeoutMs: null` — the default 30s deadline aborts a large or slow
  // download mid-body, which surfaced as an AbortError and nothing on screen.
  const res = await authedFetch(`${API_BASE}/api/v1/files/${id}/download`, {}, null);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Next tick, not this one: Firefox cancels the download when the object URL
  // is revoked before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
  // Preview lives on the page, not per row: the dialog must survive the row
  // unmounting under it when the list refetches.
  const [preview, setPreview] = useState<FileMeta | null>(null);
  async function onDelete(f: FileMeta) {
    // Name the file: the grid can show dozens of cards and the old
    // "Delete file?" gave no way to tell you had clicked the wrong one.
    if (!(await confirm({ title: `Delete "${f.original_name || f.name}"?`, destructive: true, confirmLabel: "Delete" }))) return;
    del.mutateAsync(f.id).then(() => toast.success("Deleted")).catch(toastError);
  }
  return (
    <div>
      <PageHeader
        title="Files"
        description="Uploaded and agent-generated files. Reference one in a chat or task prompt by typing @ (or pasting its file ID)."
        actions={<UploadButton />}
      />
      <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={FolderOpen} title="No files" />}>
        {(data) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.items.map((f) => (
              <Card key={f.id} className="flex flex-col overflow-hidden transition-colors hover:border-muted-foreground/40">
                {/* The thumbnail is the affordance — clicking it opens the full
                    preview. Kept as its own control so the row of actions below
                    stays reachable (no nested interactive elements). */}
                <button type="button" onClick={() => setPreview(f)} title="Preview" className="block text-left">
                  <FileThumb file={f} />
                </button>
                <div className="flex flex-1 flex-col gap-1 border-t border-border p-3">
                  <button
                    type="button"
                    onClick={() => setPreview(f)}
                    className="truncate text-left text-sm font-medium hover:underline"
                    title={f.original_name || f.name}
                  >
                    {f.original_name || f.name}
                  </button>
                  <p className="truncate text-xs text-muted-foreground" title={f.mime}>
                    {f.mime} · {bytes(f.size)} · {relativeTime(f.uploaded_at)}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Badge variant="muted">{f.scope}</Badge>
                    <button
                      type="button"
                      onClick={() => copyText(f.id, "File ID")}
                      title={`${f.id} — click to copy`}
                      className="group flex items-center gap-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {f.id.slice(0, 8)}…
                      <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      title={`Copy @${f.name} to reference this file in a chat or task prompt`}
                      onClick={() => copyText(`@${f.name}`, "Mention")}
                    >
                      <AtSign className="size-3.5" /> Mention
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => downloadFile(f.id, f.original_name || f.name).catch(toastError)}
                    >
                      Download
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDelete(f)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
      <Dialog open={preview != null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-8">{preview.original_name || preview.name}</DialogTitle>
                <DialogDescription className="text-xs">
                  {preview.mime} · {bytes(preview.size)} · {relativeTime(preview.uploaded_at)}
                </DialogDescription>
              </DialogHeader>
              <FilePreview file={preview} />
              <DialogFooter>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadFile(preview.id, preview.original_name || preview.name).catch(toastError)
                  }
                >
                  Download
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScratchEditDialog({
  page,
  onOpenChange,
  onNavigate,
}: {
  page: string | null;
  onOpenChange: (open: boolean) => void;
  /** Jump to another page (backlink click) without closing the dialog. */
  onNavigate: (page: string) => void;
}) {
  const open = page != null;
  const detail = useScratchPage(page ?? "", open);
  const save = useSaveScratchPage();
  // The delete mutation lives here, not in a child inside DialogContent: the
  // dialog closes before the delete resolves (see onDelete) and Radix unmounts
  // its content, which would tear down the hook mid-flight.
  const del = useDeleteScratchPage();
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
  // Compare against the loaded text rather than tracking a "touched" flag, so
  // typing a character and deleting it again does not prompt.
  const dirty = detail.data != null && content !== detail.data.content;
  const { confirmDiscard } = useDirtyGuard(dirty);

  /** Every exit that would drop unsaved edits routes through here. */
  async function requestClose() {
    if (await confirmDiscard()) onOpenChange(false);
  }
  async function requestNavigate(next: string) {
    if (await confirmDiscard()) onNavigate(next);
  }

  async function onDelete() {
    if (!page) return;
    if (!(await confirm({ title: `Delete "${page}"?`, destructive: true, confirmLabel: "Delete" }))) return;
    // Close first, for two reasons: the delete invalidates the whole
    // "scratchpad" key prefix, which refetches this page's still-mounted query
    // into a 404; and there is nothing to discard once the page is gone, so no
    // dirty prompt.
    onOpenChange(false);
    del.mutateAsync(page).then(() => toast.success("Deleted")).catch(toastError);
  }

  return (
    <Dialog
      open={open}
      // ESC, outside-click and the built-in X all land here.
      onOpenChange={(o) => {
        if (!o) void requestClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{page}</DialogTitle>
          <DialogDescription className="sr-only">Edit this agent note.</DialogDescription>
        </DialogHeader>
        {/* QueryState so a deleted/renamed page renders an error with a retry
            instead of a skeleton that never resolves. */}
        <QueryState query={detail} skeleton={<Skeleton className="h-64 w-full" />}>
          {(data) => (
            <>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[320px] font-mono text-xs"
              />
              {data.backlinks.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Linked from:</span>
                  {data.backlinks.map((b) => (
                    <Button
                      key={b.id}
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => void requestNavigate(b.title)}
                    >
                      {b.title}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </QueryState>
        <DialogFooter>
          <Button variant="destructive" disabled={del.isPending || !page} onClick={() => void onDelete()}>
            {del.isPending ? "Deleting…" : "Delete"}
          </Button>
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
      <PageHeader title="Scratchpad" description="Working notes agents keep for themselves between tasks." />
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
      <ScratchEditDialog
        page={editPage}
        onOpenChange={(o) => !o && setEditPage(null)}
        onNavigate={setEditPage}
      />
    </div>
  );
}

function SetSecretDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  // The API refuses to default this: `global` makes the secret readable by
  // every agent and tool on the host, so the operator has to type it. Starting
  // it pre-filled would put the widest scope back one click away, which is the
  // thing the missing server-side default exists to prevent.
  const [scope, setScope] = useState("");
  const set = useSetSecret();
  function reset() {
    setName("");
    setValue("");
    setScope("");
    // react-query keeps `variables` — i.e. the plaintext value — for the
    // observer's lifetime plus gcTime, deliberately, so a rejected call can be
    // retried. Clearing component state alone still leaves the secret readable
    // from React DevTools and any heap snapshot, so drop the mutation too.
    set.reset();
  }
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await set.mutateAsync({ name: name.trim(), value, scope: scope.trim() });
      toast.success("Secret saved");
      setOpen(false);
      reset();
    } catch (err) {
      toastError(err);
      // The dialog stays open on failure, so scrub here too — the plaintext
      // must not linger after a rejected save. The name goes with it; retyping
      // a name is cheaper than a leaked key.
      reset();
    }
  }
  return (
    // Clear on *any* dismissal, not just success: SecretsPage never unmounts,
    // so a pasted key survived ESC/outside-click for the rest of the session
    // and was re-rendered into the input the next time the dialog opened.
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>New secret</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set secret</DialogTitle>
          <DialogDescription className="sr-only">
            Store a credential in the encrypted vault. The value is never shown again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" required />
          <div className="space-y-1">
            <Input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="Scope"
              required
            />
            <p className="text-xs text-muted-foreground">
              <code>global</code>, <code>kernel</code>, <code>agent:&lt;name&gt;</code> or{" "}
              <code>tool:&lt;name&gt;</code>. <code>global</code> is readable by every agent and
              tool on this host.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={set.isPending || !name.trim() || !value || !scope.trim()}>Save</Button>
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

/** Kernel-minted per-agent signing keys; not something an operator set or should delete here. */
const AGENT_IDENTITY_PREFIX = "agent_identity:";

export function SecretsPage() {
  const query = useSecrets();
  const del = useDeleteSecret();
  const agentName = useAgentNames();
  async function onDelete(name: string) {
    if (!(await confirm({ title: `Delete secret ${name}?`, destructive: true, confirmLabel: "Delete" }))) return;
    del.mutateAsync(name).then(() => toast.success("Deleted")).catch(toastError);
  }
  return (
    <div>
      <PageHeader title="Secrets" description="Provider API keys and other credentials, stored encrypted in the vault. Values are never shown again." actions={<SetSecretDialog />} />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Lock} title="No credentials yet" action={<SetSecretDialog />} />}>
        {(items) => {
          const internal = items.filter((s) => s.name?.startsWith(AGENT_IDENTITY_PREFIX));
          const operator = items.filter((s) => !s.name?.startsWith(AGENT_IDENTITY_PREFIX));
          return (
            <div className="space-y-4">
              {operator.length === 0 ? (
                <EmptyState icon={Lock} title="No credentials yet" action={<SetSecretDialog />} />
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border">
                  {operator.map((s, i) => (
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
              {internal.length > 0 && (
                <details className="rounded-lg border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                    Internal (agent identities) · {internal.length}
                  </summary>
                  <div className="divide-y divide-border border-t border-border">
                    {internal.map((s, i) => {
                      const id = (s.name ?? "").slice(AGENT_IDENTITY_PREFIX.length);
                      return (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm" title={s.name}>
                          <Lock className="size-3.5 text-muted-foreground" />
                          <span>{agentLabel(agentName(id), id)}</span>
                          <Badge variant="muted">signing key</Badge>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          );
        }}
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

/** "api" → "API", "agent_budget" → "Agent budget". */
const ACRONYMS = new Set(["api", "otel", "hal", "mcp", "llm", "ui", "cpu", "gpu"]);
function sectionTitle(section: string): string {
  return ACRONYMS.has(section) ? section.toUpperCase() : humanizeKey(section);
}

export function ConfigPage() {
  const query = useConfig();
  const setCfg = useSetConfig();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [filter, setFilter] = useState("");
  async function onSet(e: FormEvent) {
    e.preventDefault();
    // Writes live kernel config and takes effect immediately — show the key and
    // the value, since "Set kernel.max_concurrent_tasks?" reads identically for
    // 8 and 0. Quoted so an empty or whitespace-only value is visible: the Set
    // button only requires a key.
    if (
      !(await confirm({
        title: `Set ${key.trim()} = ${JSON.stringify(value)}?`,
        description: "This writes live kernel configuration and takes effect immediately.",
        confirmLabel: "Set",
      }))
    )
      return;
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
      {/* What the operator is about to overwrite, in full — the row hints are clamped. */}
      {configHint(key.trim()) && (
        <p className="mb-4 max-w-3xl text-xs text-muted-foreground">{configHint(key.trim())}</p>
      )}
      <QueryState query={query}>
        {(tree) => {
          const leaves = flattenConfig(tree.config);
          const q = filter.trim().toLowerCase();
          const shown = q
            ? leaves.filter(
                (l) =>
                  l.key.toLowerCase().includes(q) ||
                  configValue(l.value).toLowerCase().includes(q) ||
                  // Hints too: "backlog" should find kernel.boot_replay_max_age_hours.
                  (configKeyHint(l.key)?.toLowerCase().includes(q) ?? false),
              )
            : leaves;
          // Group by the top-level section ("api", "kernel", …) — the same
          // grouping the TOML file has, so a key is where the operator expects.
          const sections = new Map<string, ConfigLeaf[]>();
          for (const leaf of shown) {
            const section = leaf.key.split(".")[0];
            const rows = sections.get(section);
            if (rows) rows.push(leaf);
            else sections.set(section, [leaf]);
          }
          return (
            <div>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter keys and values…"
                className="mb-4 max-w-sm"
              />
              {sections.size === 0 ? (
                <EmptyState icon={Sliders} title="No matching keys" />
              ) : (
                <div className="columns-1 gap-4 lg:columns-2 xl:columns-3">
                  {[...sections].map(([section, rows]) => (
                    <Card key={section} className="mb-4 break-inside-avoid">
                      <CardHeader className="space-y-1 p-4 pb-2">
                        <CardTitle className="text-sm">{sectionTitle(section)}</CardTitle>
                        {configSectionHint(section) && (
                          <CardDescription className="line-clamp-3 text-[11px] leading-snug">
                            {configSectionHint(section)}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="p-2 pt-0">
                        {rows.map((leaf) => {
                          const redacted = leaf.value === "***REDACTED***";
                          const hint = configKeyHint(leaf.key);
                          return (
                            <button
                              key={leaf.key}
                              type="button"
                              // Rows are the fastest way into the Set form: the
                              // dotted key is exactly what the write endpoint takes.
                              onClick={() => {
                                setKey(leaf.key);
                                setValue(redacted ? "" : JSON.stringify(leaf.value));
                              }}
                              title={[
                                `${leaf.key} = ${configValue(leaf.value)}`,
                                configHint(leaf.key),
                              ]
                                .filter(Boolean)
                                .join("\n\n")}
                              className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono text-xs text-muted-foreground">
                                  {leaf.key.slice(section.length + 1) || section}
                                </span>
                                {hint && (
                                  <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground/70">
                                    {hint}
                                  </span>
                                )}
                              </span>
                              {redacted ? (
                                <Badge variant="muted">redacted</Badge>
                              ) : (
                                <span
                                  className={cn(
                                    "max-w-[55%] shrink-0 truncate font-mono text-xs",
                                    leaf.value == null && "text-muted-foreground",
                                  )}
                                >
                                  {configValue(leaf.value)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-muted-foreground">Raw JSON</summary>
                <pre className="mt-2 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs">
                  {JSON.stringify(tree.config, null, 2)}
                </pre>
              </details>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}

export function DoctorPage() {
  const query = useDoctor();
  const fix = useDoctorFix();
  // Auto-fix rewrites config and environment files; it was a single unguarded click.
  async function onFix() {
    if (
      !(await confirm({
        title: "Run auto-fix?",
        description: "Doctor will modify configuration and environment files to repair failing checks.",
        confirmLabel: "Run auto-fix",
      }))
    )
      return;
    fix.mutateAsync().then(() => toast.success("Ran fixes")).catch(toastError);
  }
  return (
    <div>
      <PageHeader
        title="Doctor"
        description="Configuration and environment diagnostics."
        actions={
          <Button onClick={() => void onFix()} disabled={fix.isPending}>
            {fix.isPending ? "Fixing…" : "Auto-fix"}
          </Button>
        }
      />
      <QueryState query={query}>
        {(report) => (
          <div className="space-y-2">
            {(() => {
              const warns = report.checks.filter((c) => c.status === "warn").length;
              const fails = report.checks.filter((c) => c.status === "fail").length;
              const tone = fails > 0 ? "danger" : warns > 0 ? "warning" : "success";
              const text =
                fails > 0
                  ? `${fails} check${fails === 1 ? "" : "s"} failing.`
                  : warns > 0
                    ? `All checks passing, ${warns} warning${warns === 1 ? "" : "s"}.`
                    : "All checks passing.";
              return (
                <Callout tone={tone} role="status" title={text}>
                  {fails > 0
                    ? "Fix the failing checks below; some agent features may not work until they pass."
                    : warns > 0
                      ? "Warnings don’t block anything, but they are worth a look."
                      : "The kernel, storage and providers all look healthy."}
                </Callout>
              );
            })()}
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
  const [limit, setLimit] = useState(200);
  const [filter, setFilter] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const query = useLogs(limit);
  const data = query.data;
  // Levels present in the fetched window (normalized); "warning" shows as "warn".
  const present = useMemo(
    () => [...new Set((data ?? []).map((l) => normLevel(l.severity)))].sort(),
    [data],
  );
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = (data ?? []).filter(
      (l) =>
        (levels.size === 0 || levels.has(normLevel(l.severity))) &&
        (!q || l.line.toLowerCase().includes(q)),
    );
    return newestFirst ? rows.reverse() : rows;
  }, [data, filter, levels, newestFirst]);
  function toggleLevel(level: string) {
    setLevels((prev) => {
      const next = new Set(prev);
      if (!next.delete(level)) next.add(level);
      return next;
    });
  }
  return (
    <div>
      <PageHeader title="Logs" description="Recent kernel log lines. Filter by level or text, newest first." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter lines…"
          aria-label="Filter log lines"
          className="max-w-xs"
        />
        <Select
          value={String(limit)}
          onChange={(e) => setLimit(Number(e.target.value))}
          aria-label="Line count"
          className="w-auto"
        >
          {[200, 500, 1000].map((n) => (
            <option key={n} value={n}>{n} lines</option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => setNewestFirst((v) => !v)}>
          {newestFirst ? "Newest first" : "Oldest first"}
        </Button>
        {present.map((level) => (
          <Button
            key={level}
            size="sm"
            variant={levels.has(level) ? "secondary" : "ghost"}
            aria-pressed={levels.has(level)}
            className={cn("uppercase", SEV_COLOR[level])}
            onClick={() => toggleLevel(level)}
          >
            {level}
          </Button>
        ))}
        {data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {shown.length} / {data.length}
          </span>
        )}
      </div>
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={FileText} title="No logs" />}>
        {() => (
          <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed">
            {shown.length === 0 && <div className="text-muted-foreground">No lines match.</div>}
            {shown.map((l, i) => (
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

function normLevel(severity: string | undefined): string {
  const s = (severity ?? "").toLowerCase();
  return s === "warning" ? "warn" : s || "info";
}

export function ResourcesPage() {
  const query = useResources();
  return (
    <div>
      <PageHeader title="Resources" description="Kernel status, hardware, memory, disk and what is currently locked." />
      <div className="mb-4">
        <SystemStatusCards />
      </div>
      <QueryState query={query}>
        {(r) => (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Memory</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="tnum text-2xl font-semibold tracking-tight">
                    {Math.round(r.mem_used_mb)} / {Math.round(r.mem_total_mb)} MB
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">used / total</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Disk</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="tnum text-2xl font-semibold tracking-tight">{bytes(r.disk_free_bytes)} free</p>
                  <p className="mt-1 text-xs text-muted-foreground">of {bytes(r.disk_total_bytes)} · {r.data_dir}</p>
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
                  {r.contention
                    ? ` · contention: ${
                        typeof r.contention === "object"
                          ? JSON.stringify(r.contention)
                          : String(r.contention)
                      }`
                    : ""}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ── API keys ────────────────────────────────────────────────────────────────
function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // No default: a key that silently starts as `*:rw` is the one mistake this
  // dialog must not make. The operator types the scopes they mean.
  const [scopes, setScopes] = useState("");
  const [ttlDays, setTtlDays] = useState("30");
  // The full key is returned exactly once; hold it until the operator copies it.
  const [issued, setIssued] = useState<string | null>(null);
  const create = useCreateApiKey();

  function reset() {
    setName("");
    setScopes("");
    setTtlDays("30");
    setIssued(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const days = Number(ttlDays);
    const scopeList = scopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (scopeList.length === 0) {
      toast.error("Enter at least one scope", { description: "A key without scopes can do nothing." });
      return;
    }
    try {
      const res = await create.mutateAsync({
        name: name.trim(),
        scopes: scopeList,
        ttl_secs: Number.isFinite(days) && days > 0 ? Math.round(days * 86400) : null,
      });
      setIssued(res.api_key);
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // DialogContent always renders Radix's X, and it calls onOpenChange(false)
        // *directly* — the three guards below never see it. Without this check the
        // X (4px from Copy) discards a key the server will never return again.
        // Only "Done" closes while a key is on screen.
        if (!o && issued) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Create key</Button>
      </DialogTrigger>
      <DialogContent
        // While the shown-once key is on screen, block ESC/outside-click
        // dismissal — closing wipes it and it cannot be re-fetched.
        onEscapeKeyDown={(e) => issued && e.preventDefault()}
        onPointerDownOutside={(e) => issued && e.preventDefault()}
        onInteractOutside={(e) => issued && e.preventDefault()}
      >
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>Key created — copy it now</DialogTitle>
            </DialogHeader>
            <DialogDescription>This is the only time the full key is shown.</DialogDescription>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-2 text-xs">
                {issued}
              </code>
              <Button size="sm" onClick={() => copyText(issued, "API key")}>
                <Copy className="size-3.5" /> Copy
              </Button>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription className="sr-only">
                Name the key and choose its scopes. The full key is shown once after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-3">
              <div className="space-y-1">
                <label htmlFor="key-name" className="text-sm font-medium">Name</label>
                <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-bot" autoFocus />
              </div>
              <div className="space-y-1">
                <label htmlFor="key-scopes" className="text-sm font-medium">Scopes (comma-separated)</label>
                <Input id="key-scopes" value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="tasks:r, agents:r" required />
                <p className="text-xs text-muted-foreground">
                  <code>resource:op</code> pairs; <code>*:rw</code> = full access.
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="key-ttl" className="text-sm font-medium">Expires in (days, blank = never)</label>
                <Input id="key-ttl" value={ttlDays} onChange={(e) => setTtlDays(e.target.value)} placeholder="30" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function KeysPage() {
  const currentKeyId = useAuthStore((s) => s.keyId);
  const query = useApiKeys();
  const revoke = useRevokeApiKey();
  // Per-row in-flight set (same pattern as govern's EscalationsPage): the
  // shared `revoke.isPending` disabled Revoke on every key, so one hung call
  // froze the whole list for the full 30s request deadline.
  const [revoking, setRevoking] = useState<ReadonlySet<string>>(new Set());
  async function onRevoke(id: string, name: string) {
    if (
      !(await confirm({
        title: `Revoke key "${name}"?`,
        description: "Clients using this key lose access immediately.",
        destructive: true,
        confirmLabel: "Revoke",
      }))
    )
      return;
    setRevoking((prev) => new Set(prev).add(id));
    try {
      await revoke.mutateAsync(id);
      toast.success("Revoked");
    } catch (err) {
      toastError(err);
    } finally {
      setRevoking((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }
  return (
    <div>
      <PageHeader
        title="API keys"
        description="Scoped bearer keys for scripts and integrations. Full key is shown once at creation."
        actions={<CreateKeyDialog />}
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={KeySquare} title="No API keys" />}
      >
        {(items) => (
          <div className="space-y-2">
            {items.map((k) => (
              <Card key={k.key_id} className={k.revoked ? "opacity-60" : undefined}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{k.name}</p>
                      {k.key_id === currentKeyId && <Badge>this session</Badge>}
                      {k.revoked && <Badge variant="muted">revoked</Badge>}
                      {!k.revoked && k.expires_at && new Date(k.expires_at).getTime() < Date.now() && (
                        <Badge variant="muted">expired</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <code>{k.key_id.slice(0, 12)}…</code> · scopes:{" "}
                      {(k.scopes ?? []).join(", ") || "no scopes (no access)"} · created{" "}
                      {relativeTime(k.created_at)}
                      {k.expires_at
                        ? new Date(k.expires_at).getTime() < Date.now()
                          ? ` · expired ${relativeTime(k.expires_at)}`
                          : ` · expires ${relativeTime(k.expires_at)}`
                        : ""}
                      {k.last_used_at ? ` · last used ${relativeTime(k.last_used_at)}` : " · never used"}
                    </p>
                  </div>
                  {!k.revoked && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoking.has(k.key_id)}
                      onClick={() => void onRevoke(k.key_id, k.name)}
                    >
                      {revoking.has(k.key_id) ? "Revoking…" : "Revoke"}
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

// ── System status + HAL (extends Resources page) ────────────────────────────
export function SystemStatusCards() {
  const status = useSystemStatus();
  const hal = useHal();
  return (
    <div className="space-y-4">
      <QueryState query={status} skeleton={<Skeleton className="h-20 w-full" />}>
        {(s) => (
          <Card>
            <CardHeader>
              <CardTitle>Kernel</CardTitle>
            </CardHeader>
            <CardContent>
              <StatGrid min={130}>
                <Stat size="sm" label="Version" value={<span className="font-mono text-base">{s.version}</span>} />
                <Stat
                  size="sm"
                  label="Uptime"
                  value={`${Math.floor(s.uptime_secs / 3600)}h ${Math.floor((s.uptime_secs % 3600) / 60)}m`}
                />
                <Stat size="sm" label="Agents" value={s.agent_count} />
                <Stat size="sm" label="Tasks" value={s.task_count} />
                <Stat size="sm" label="Tools" value={s.tool_count} />
              </StatGrid>
            </CardContent>
          </Card>
        )}
      </QueryState>
      <QueryState query={hal} skeleton={<Skeleton className="h-20 w-full" />}>
        {(h) => (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4" /> Hardware
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(h.devices ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No devices reported.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {(h.devices ?? []).map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{d.id}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant="muted">{d.device_type}</Badge>
                        <StatusBadge status={d.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {(h.devices ?? []).some((d) => d.status === "pending") && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Pending</span> devices await operator approval
                  before an agent can use them. If an agent already asked, it is in{" "}
                  <Link to={"/escalations" as string} className="underline">Approvals</Link>; otherwise grant
                  access from the CLI: <code>agentos hal approve &lt;device-id&gt; --agent &lt;agent-name&gt;</code>.
                </p>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Raw system snapshot
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs">
                  {JSON.stringify(h.system, null, 2)}
                </pre>
              </details>
            </CardContent>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
