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
  usePipelineRunEvents,
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
import { absoluteTime, relativeTime } from "@/lib/format";
import { durationBetween, formatDuration } from "@/lib/task-duration";
import { ApiError } from "@/api/client";
import type { ScheduleSummary, PipelineSummary } from "@/api/models";
import { Callout } from "@/components/ui/callout";

const EMPTY_SCHEDULE = {
  name: "",
  agent_name: "",
  cron: "0 9 * * *",
  prompt: "",
  delivery_mode: "via_agent",
};

function CreateScheduleDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_SCHEDULE);
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
        // No silent fallback to the first agent: the schedule runs under this
        // agent's permissions, so an unset select must not quietly pick one.
        name: form.name.trim(),
        agent_name: form.agent_name,
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Every sibling dialog resets on close; this one used to reopen showing
        // the previous schedule's name and prompt.
        if (!o) {
          setForm(EMPTY_SCHEDULE);
          setPreview([]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>New schedule</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create schedule</DialogTitle>
          <DialogDescription>Recurring cron job run by an agent; preview the next runs before saving.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Name" required />
          <Select value={form.agent_name} onChange={(e) => set("agent_name", e.target.value)} required>
            <option value="">{agents.data?.length ? "Agent to run it as…" : "No agents"}</option>
            {(agents.data ?? []).filter((a) => a.status !== "offline").map((a) => (
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
            <Button
              type="submit"
              disabled={
                create.isPending || !form.name.trim() || !form.prompt.trim() || !form.agent_name
              }
            >
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
  // A hard DELETE with no undo, so the prompt has to name what it destroys.
  async function onDelete(s: ScheduleSummary) {
    if (!(await confirm({ title: `Delete schedule ${s.name}?`, destructive: true, confirmLabel: "Delete" }))) return;
    del.mutateAsync(String(s.id)).then(() => toast.success("Deleted")).catch(toastError);
  }
  // One flight at a time: pause/resume are the same toggle, and a double-click
  // used to fire two requests whose order decided the final state.
  const toggling = pause.isPending || resume.isPending;
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
      cell: (s) =>
        s.cron ? <code className="whitespace-nowrap text-xs">{s.cron}</code> : <span className="text-muted-foreground">—</span>,
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
              {s.state === "active" ? (
                <Button variant="ghost" size="sm" disabled={toggling} onClick={() => pause.mutateAsync(String(s.id)).catch(toastError)}>
                  Pause
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled={toggling} onClick={() => resume.mutateAsync(String(s.id)).catch(toastError)}>
                  Resume
                </Button>
              )}
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => onDelete(s)}>
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

/** The `name:` a pipeline YAML declares — enough to spot a collision before installing. */
function yamlPipelineName(yaml: string): string {
  return yaml.match(/^name:[ \t]*['"]?([^'"\n#]+?)['"]?[ \t]*$/m)?.[1] ?? "";
}

function ImportPipelineDialog() {
  const [open, setOpen] = useState(false);
  const [yaml, setYaml] = useState("");
  const existing = usePipelines();
  const importPipeline = useImportPipeline();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Import writes over a same-named pipeline in place, so a paste that reuses
    // a production name destroys it with no prompt and no undo — same hole the
    // builder had before the API started answering 409.
    const target = yamlPipelineName(yaml);
    if (target && (existing.data ?? []).some((p) => p.name === target)) {
      const replace = await confirm({
        title: `Replace the pipeline "${target}"?`,
        description: "A pipeline with that name already exists. Importing replaces its definition — there is no undo.",
        confirmLabel: "Replace",
        destructive: true,
      });
      if (!replace) return;
    }
    try {
      await importPipeline.mutateAsync(yaml);
      toast.success("Pipeline installed");
      setOpen(false);
      setYaml("");
    } catch (err) {
      // Unlike POST /pipelines, ImportPipelineRequest carries no `overwrite`
      // flag, so a 409 here has no retry — say what to do instead of failing
      // with a bare conflict code.
      if (err instanceof ApiError && err.status === 409) {
        toast.error(`Pipeline "${target || "with that name"}" already exists`, {
          description: "Rename it in the YAML, or delete the existing pipeline first.",
        });
        return;
      }
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

/**
 * A detached run's snapshot is an untyped kernel Value; this mirrors
 * `PipelineRun` / `StepResult` (agos agentos-pipeline/src/types.rs). Every
 * field is optional so drift degrades to "—" and the raw JSON below.
 */
interface RunStep {
  step_id?: string;
  status?: string;
  error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  attempt?: number;
}
interface RunSnapshot {
  status?: string;
  started_at?: string;
  completed_at?: string | null;
  error?: string | null;
  output?: string | null;
  step_results?: Record<string, RunStep>;
}

function RunSnapshotView({ snap }: { snap: Record<string, unknown> }) {
  const run = snap as RunSnapshot;
  const steps = Object.entries(run.step_results ?? {})
    .map(([id, s]) => ({ ...s, step_id: s.step_id ?? id }))
    // Pending steps have no start time; keep them after the ones that ran.
    .sort((a, b) =>
      !a.started_at || !b.started_at
        ? Number(!a.started_at) - Number(!b.started_at)
        : a.started_at.localeCompare(b.started_at),
    );
  const took = run.completed_at
    ? durationBetween(run.started_at, run.completed_at)
    : durationBetween(run.started_at, new Date().toISOString());
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
        {run.status && <StatusBadge status={run.status} />}
        {run.started_at && (
          <span title={absoluteTime(run.started_at)}>started {relativeTime(run.started_at)}</span>
        )}
        {run.completed_at && (
          <span title={absoluteTime(run.completed_at)}>
            finished {relativeTime(run.completed_at)}
          </span>
        )}
        {took && <span>{run.completed_at ? "took" : "running for"} {took}</span>}
      </div>
      {run.error && (
        <Callout tone="danger" role="alert">
          <span className="whitespace-pre-wrap break-words font-mono text-xs">{run.error}</span>
        </Callout>
      )}
      {steps.length === 0 ? (
        <p className="text-muted-foreground">No steps have run yet.</p>
      ) : (
        <ol className="divide-y divide-border rounded-md border border-border">
          {steps.map((s) => (
            <li key={s.step_id} className="space-y-1 p-2">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{s.step_id}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {s.attempt != null && s.attempt > 1 && <span>attempt {s.attempt}</span>}
                  <span>
                    {s.duration_ms != null
                      ? formatDuration(s.duration_ms)
                      : (durationBetween(s.started_at, s.completed_at) ?? "—")}
                  </span>
                  {s.status && <StatusBadge status={s.status} />}
                </span>
              </div>
              {s.error && (
                <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                  {s.error}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {run.output && (
        <details>
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            Output
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
            {run.output}
          </p>
        </details>
      )}
      <details>
        <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
          Raw JSON
        </summary>
        <pre className="mt-2 max-h-[40vh] overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs">
          {JSON.stringify(snap, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function RunPipelineDialog({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  // The kernel requires a governing agent for permission enforcement — running
  // without one fails (as a 500) in resolve_pipeline_agent.
  const [agentName, setAgentName] = useState("");
  const agents = useAgents();
  // Set once a detached run starts; switches the dialog to the live snapshot.
  const [runId, setRunId] = useState<string | null>(null);
  const run = useRunPipeline();
  // Null while the form is up, and again once the dialog closes, so the hook
  // stays disabled; it stops its own polling when the snapshot reports a
  // terminal status.
  const events = usePipelineRunEvents(open ? runId : null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = (await run.mutateAsync({ name, input: input.trim(), agent_name: agentName })) as
        | Record<string, unknown>
        | undefined;
      // Detached runs return { id, status, detached, background_task_id }
      // (kernel commands/pipeline.rs) — `id` is the run id the events
      // endpoint expects.
      const id = res && typeof res.id === "string" ? res.id : null;
      toast.success(`Pipeline "${name}" started`);
      setInput("");
      if (id) setRunId(id);
      else setOpen(false); // no run id returned — nothing to watch
    } catch (err) {
      toastError(err);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setRunId(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">Run</Button>
      </DialogTrigger>
      <DialogContent className={runId ? "max-w-2xl" : undefined}>
        <DialogHeader>
          <DialogTitle>{runId ? `Run ${runId.slice(0, 8)}… — ${name}` : `Run ${name}`}</DialogTitle>
          <DialogDescription>
            {runId
              ? "Live step status; polling stops once the run settles."
              : "Pick the governing agent and the input, then start a detached run."}
          </DialogDescription>
        </DialogHeader>
        {runId ? (
          <div className="max-h-[60vh] overflow-y-auto">
            <QueryState query={events}>{(snap) => <RunSnapshotView snap={snap} />}</QueryState>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-3">
            <Select value={agentName} onChange={(e) => setAgentName(e.target.value)} required>
              <option value="">{agents.data?.length ? "Governing agent…" : "No agents"}</option>
              {(agents.data ?? []).filter((a) => a.status !== "offline").map((a) => (
                <option key={a.id} value={a.name}>{a.name}</option>
              ))}
            </Select>
            <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pipeline input…" required />
            <DialogFooter>
              <Button type="submit" disabled={run.isPending || !input.trim() || !agentName}>Run</Button>
            </DialogFooter>
          </form>
        )}
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
        description="Multi-step workflows that chain agents and tools. Build one visually or import YAML."
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

