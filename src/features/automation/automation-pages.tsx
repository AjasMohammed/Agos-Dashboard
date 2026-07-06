import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarClock, Workflow, Plus } from "lucide-react";
import {
  useSchedules,
  useScheduleRuns,
  useCreateSchedule,
  usePreviewCron,
  useToggleSchedule,
  useDeleteSchedule,
  usePipelines,
  useRunPipeline,
  useDeletePipeline,
  useImportPipeline,
  exportPipeline,
} from "@/api/queries/automation";
import { useAgents } from "@/api/queries/agents";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import type { ScheduleSummary, PipelineSummary } from "@/api/models";

function CreateScheduleDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", agent_name: "", cron: "0 9 * * *", prompt: "", delivery_mode: "via_agent" });
  const [preview, setPreview] = useState<string[]>([]);
  const agents = useAgents();
  const create = useCreateSchedule();
  const previewCron = usePreviewCron();
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onPreview() {
    try {
      const res = await previewCron.mutateAsync(form.cron);
      setPreview(res.next_runs ?? []);
    } catch (e) {
      toastError(e);
    }
  }
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        agent_name: form.agent_name || (agents.data?.[0]?.name ?? ""),
        cron: form.cron.trim(),
        prompt: form.prompt.trim(),
        delivery_mode: form.delivery_mode,
      });
      toast.success("Schedule created");
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New schedule</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create schedule</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Name" required />
          <Select value={form.agent_name} onChange={(e) => set("agent_name", e.target.value)}>
            <option value="">{agents.data?.length ? "Agent…" : "No agents"}</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={a.name}>{a.name}</option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Input value={form.cron} onChange={(e) => set("cron", e.target.value)} placeholder="Cron (e.g. 0 9 * * *)" required />
            <Button type="button" variant="outline" onClick={onPreview} disabled={previewCron.isPending}>
              Preview
            </Button>
          </div>
          {preview.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Next: {preview.slice(0, 3).map((r) => new Date(r).toLocaleString()).join(" · ")}
            </p>
          )}
          <Select value={form.delivery_mode} onChange={(e) => set("delivery_mode", e.target.value)}>
            <option value="via_agent">via_agent</option>
            <option value="direct">direct</option>
            <option value="silent">silent</option>
          </Select>
          <Textarea value={form.prompt} onChange={(e) => set("prompt", e.target.value)} placeholder="Prompt to run…" required />
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !form.name.trim() || !form.prompt.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Per-schedule run history — "did my schedule actually fire, and did it fail". */
function RunHistoryDialog({
  scheduleId,
  onOpenChange,
}: {
  scheduleId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const runs = useScheduleRuns(scheduleId);
  return (
    <Dialog open={scheduleId != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Run history</DialogTitle>
          <DialogDescription>Most recent firings of this schedule.</DialogDescription>
        </DialogHeader>
        <QueryState
          query={runs}
          isEmpty={(d) => d.length === 0}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">No runs recorded yet.</p>}
        >
          {(items) => (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {items.map((r) => (
                <div
                  key={r.run_id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-sm"
                >
                  <span className="text-muted-foreground">{relativeTime(r.fired_at)}</span>
                  <StatusBadge status={r.status} />
                  {r.task_id ? (
                    <Link
                      to="/tasks/$id"
                      params={{ id: String(r.task_id) }}
                      className="truncate text-xs text-primary hover:underline"
                    >
                      task {String(r.task_id).slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulesPage() {
  const query = useSchedules();
  const pause = useToggleSchedule("pause");
  const resume = useToggleSchedule("resume");
  const del = useDeleteSchedule();
  const [historyId, setHistoryId] = useState<string | null>(null);
  async function onDelete(id: string) {
    if (!(await confirm({ title: "Delete schedule?", destructive: true, confirmLabel: "Delete" }))) return;
    del.mutateAsync(id).then(() => toast.success("Deleted")).catch(toastError);
  }
  const columns: Column<ScheduleSummary>[] = [
    { key: "name", header: "Name", cell: (s) => <span className="font-medium">{s.name}</span> },
    {
      key: "kind",
      header: "Type",
      cell: (s) => <Badge variant={s.kind === "cron" ? "default" : "secondary"}>{s.kind}</Badge>,
    },
    { key: "agent", header: "Agent", cell: (s) => <span className="text-muted-foreground">{s.agent_name ?? "—"}</span> },
    {
      key: "cron",
      header: "Cron",
      cell: (s) => (s.cron ? <code className="text-xs">{s.cron}</code> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: "next",
      header: "Next run",
      cell: (s) => <span className="text-muted-foreground">{relativeTime(s.next_run_at)}</span>,
    },
    { key: "runs", header: "Runs", cell: (s) => (s.kind === "cron" ? s.run_count : "—") },
    {
      key: "actions",
      header: "",
      cell: (s) => (
        <span className="flex gap-1">
          {s.kind === "cron" && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setHistoryId(String(s.id))}>
                History
              </Button>
              <Button variant="ghost" size="sm" onClick={() => pause.mutateAsync(String(s.id)).catch(toastError)}>
                Pause
              </Button>
              <Button variant="ghost" size="sm" onClick={() => resume.mutateAsync(String(s.id)).catch(toastError)}>
                Resume
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => onDelete(String(s.id))}>
            Delete
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Schedules"
        description="Recurring cron jobs plus one-shot reminders and timers created by agents."
        actions={<CreateScheduleDialog />}
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={CalendarClock} title="No schedules" />}>
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(s) => String(s.id)} />}
      </QueryState>
      <RunHistoryDialog scheduleId={historyId} onOpenChange={(o) => !o && setHistoryId(null)} />
    </div>
  );
}

const PIPELINE_YAML_PLACEHOLDER = `name: my-pipeline
description: What this pipeline does
steps:
  - name: step-one
    prompt: "…"
`;

function ImportPipelineDialog() {
  const [open, setOpen] = useState(false);
  const [yaml, setYaml] = useState("");
  const importPipeline = useImportPipeline();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await importPipeline.mutateAsync(yaml);
      toast.success("Pipeline installed");
      setOpen(false);
      setYaml("");
    } catch (err) {
      toastError(err);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Import YAML</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import pipeline</DialogTitle>
          <DialogDescription>
            Paste a YAML definition (use Export on an existing pipeline as a starting point) — or
            build one visually with “New pipeline”.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Textarea
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            placeholder={PIPELINE_YAML_PLACEHOLDER}
            className="min-h-64 font-mono text-xs"
            spellCheck={false}
            required
          />
          <DialogFooter>
            <Button type="submit" disabled={importPipeline.isPending || !yaml.trim()}>
              {importPipeline.isPending ? "Installing…" : "Install"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RunPipelineDialog({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const run = useRunPipeline();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await run.mutateAsync({ name, input: input.trim() });
      toast.success(`Pipeline "${name}" started`);
      setOpen(false);
      setInput("");
    } catch (err) {
      toastError(err);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">Run</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run {name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pipeline input…" required />
          <DialogFooter>
            <Button type="submit" disabled={run.isPending || !input.trim()}>Run</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PipelinesPage() {
  const query = usePipelines();
  const del = useDeletePipeline();
  async function onDelete(name: string) {
    if (!(await confirm({ title: `Delete pipeline ${name}?`, destructive: true, confirmLabel: "Delete" }))) return;
    del.mutateAsync(name).then(() => toast.success("Deleted")).catch(toastError);
  }
  const columns: Column<PipelineSummary>[] = [
    { key: "name", header: "Name", cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: "desc", header: "Description", cell: (p) => <span className="text-muted-foreground">{p.description}</span> },
    { key: "steps", header: "Steps", cell: (p) => p.step_count },
    {
      key: "actions",
      header: "",
      cell: (p) => (
        <span className="flex gap-1">
          <RunPipelineDialog name={p.name} />
          <Button asChild variant="ghost" size="sm">
            <Link to="/pipelines/$name/edit" params={{ name: p.name }}>
              Edit
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportPipeline(p.name).catch(toastError)}
          >
            Export
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(p.name)}>Delete</Button>
        </span>
      ),
    },
  ];
  const newPipelineButton = (
    <Button asChild>
      <Link to="/pipelines/new">
        <Plus /> New pipeline
      </Link>
    </Button>
  );
  return (
    <div>
      <PageHeader
        title="Pipelines"
        description="Multi-step agent pipelines."
        actions={
          <>
            <ImportPipelineDialog />
            {newPipelineButton}
          </>
        }
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Workflow} title="No pipelines" description="Build a pipeline visually, or import a YAML definition." action={newPipelineButton} />}
      >
        {(rows) => <DataTable columns={columns} rows={rows} getRowId={(p) => p.name} />}
      </QueryState>
    </div>
  );
}

