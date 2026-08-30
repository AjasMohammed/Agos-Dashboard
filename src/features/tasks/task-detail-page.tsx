import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  useTask,
  useTaskTrace,
  useTaskCheckpoints,
  useCancelTask,
  useResumeTask,
} from "@/api/queries/tasks";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { taskKeys } from "@/api/queries/tasks";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Markdown } from "@/components/markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { confirm } from "@/lib/confirm";
import { humanizeEvent } from "@/features/integrate/event-catalog";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { taskTitle } from "@/lib/task-title";
import { durationBetween } from "@/lib/task-duration";
import { RunTaskDialog } from "./run-task-dialog";
import { TaskTraceView, truncateText } from "./task-trace";
import type { TaskTrace } from "@/api/models";

const RUNNING = ["running", "pending", "queued", "in_progress"];
const RESUMABLE = ["suspended", "paused", "checkpointed"];
/** Raw-JSON cap. A task that read a 20 MB log used to materialise all of it. */
const RAW_TRACE_CHARS = 200_000;

/**
 * The raw payload, stringified only while the disclosure is actually open.
 * `<details>` hides children with CSS but React keeps rendering them, so this
 * block used to re-run `JSON.stringify` over the whole trace on every render —
 * including the 5s poll of a running task — and lock the tab up on a big one.
 */
function RawTraceJson({ trace }: { trace: TaskTrace }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(
    () => (open ? truncateText(JSON.stringify(trace, null, 2), RAW_TRACE_CHARS) : ""),
    [open, trace],
  );
  return (
    <details
      className="group"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
        Raw trace JSON
      </summary>
      {open && (
        <pre className="mt-2 overflow-auto rounded-lg border border-border bg-muted p-4 text-xs">
          {text}
        </pre>
      )}
    </details>
  );
}

export function TaskDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const [tab, setTab] = useState("overview");
  const query = useTask(id);
  const trace = useTaskTrace(id, tab === "trace");
  const checkpoints = useTaskCheckpoints(id, tab === "checkpoints");
  const cancel = useCancelTask();
  const resume = useResumeTask();
  const navigate = useNavigate();
  // Latest route param, readable from an async handler (see onCancel).
  const currentId = useRef(id);
  currentId.current = id;
  // Live: refresh this task on any task event.
  useInvalidateOnEvent(`tasks:${id}`, [taskKeys.detail(id)]);

  async function onCancel() {
    if (cancel.isPending) return;
    const target = id;
    const ok = await confirm({
      title: "Cancel this task?",
      description: `Task ${target.slice(0, 8)} stops where it is and cannot be un-cancelled.`,
      destructive: true,
      confirmLabel: "Cancel task",
      cancelLabel: "Keep running",
    });
    if (!ok) return;
    // Browser Back works through the confirm overlay and this route reuses the
    // component across ids, so the id captured at click time can be a task the
    // operator has already navigated away from. Never cancel that one.
    if (currentId.current !== target) return;
    try {
      await cancel.mutateAsync(target);
      toast.success("Task cancelled");
    } catch (e) {
      toastError(e);
    }
  }

  async function onResume() {
    try {
      await resume.mutateAsync(id);
      toast.success("Task resumed");
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
        <Button asChild variant="ghost" size="icon">
          <Link to="/tasks">
            <ArrowLeft />
          </Link>
        </Button>
        Tasks
      </div>
      <QueryState query={query}>
        {(t) => {
          const status = t.status.toLowerCase();
          return (
            <div className="space-y-4 pb-10">
              <PageHeader
                title={taskTitle(t.prompt, 90) || `Task ${t.id.slice(0, 8)}`}
                description={`${t.agent_name ?? "unrouted"} · ${t.id.slice(0, 8)}`}
                actions={
                  <>
                    {/* Keyed on the task so the dialog's pre-fill follows the route. */}
                    <RunTaskDialog
                      key={t.id}
                      initial={{ prompt: t.prompt, agentName: t.agent_name }}
                      trigger={
                        <Button variant="outline">
                          <RotateCcw />
                          Run again
                        </Button>
                      }
                      onStarted={(taskId) => {
                        if (taskId) void navigate({ to: "/tasks/$id", params: { id: taskId } });
                      }}
                    />
                    {RUNNING.includes(status) && (
                      <Button variant="destructive" onClick={onCancel} disabled={cancel.isPending}>
                        Cancel
                      </Button>
                    )}
                    {RESUMABLE.includes(status) && (
                      <Button onClick={onResume} disabled={resume.isPending}>
                        Resume
                      </Button>
                    )}
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <StatusBadge status={t.status} />
                <span>created {relativeTime(t.created_at)}</span>
                {t.completed_at && <span>completed {relativeTime(t.completed_at)}</span>}
                {durationBetween(t.created_at, t.completed_at) && (
                  <span title="created → completed">
                    took {durationBetween(t.created_at, t.completed_at)}
                  </span>
                )}
                {t.trigger_event_type && (
                  <span title="This task was created by an event subscription">
                    triggered by <span className="font-medium text-foreground">{humanizeEvent(t.trigger_event_type)}</span>
                  </span>
                )}
              </div>

              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="trace">Trace</TabsTrigger>
                  <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="space-y-4">
                  {t.error && (
                    <Card className="border-destructive/40">
                      <CardHeader>
                        <CardTitle className="text-destructive">Failure reason</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="whitespace-pre-wrap break-words font-mono text-sm">{t.error}</p>
                      </CardContent>
                    </Card>
                  )}
                  {t.result && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Result</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Markdown className="text-sm">{t.result}</Markdown>
                      </CardContent>
                    </Card>
                  )}
                  <Card>
                    <CardHeader>
                      <CardTitle>Prompt</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="whitespace-pre-wrap text-sm">{t.prompt}</p>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="trace">
                  <QueryState
                    query={trace}
                    isEmpty={(d) => !d || d.iterations.length === 0}
                    empty={
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No execution trace yet — tool calls and outputs appear here as the task runs.
                      </p>
                    }
                  >
                    {(data) =>
                      data && (
                        <div className="space-y-4">
                          <TaskTraceView trace={data} />
                          <RawTraceJson trace={data} />
                        </div>
                      )
                    }
                  </QueryState>
                </TabsContent>
                <TabsContent value="checkpoints">
                  <QueryState
                    query={checkpoints}
                    isEmpty={(d) => d.length === 0}
                    empty={
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No checkpoints for this task.
                      </p>
                    }
                  >
                    {(items) => (
                      <div className="space-y-2">
                        {items.map((c, i) => (
                          <div key={i} className="rounded-md border border-border p-3 text-sm">
                            {Object.entries(c as Record<string, unknown>).map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-3">
                                <span className="text-muted-foreground">{k}</span>
                                <span className="truncate">
                                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </QueryState>
                </TabsContent>
              </Tabs>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
