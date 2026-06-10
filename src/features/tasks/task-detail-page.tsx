import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";

const RUNNING = ["running", "pending", "queued", "in_progress"];
const RESUMABLE = ["suspended", "paused", "checkpointed"];

export function TaskDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const [tab, setTab] = useState("overview");
  const query = useTask(id);
  const trace = useTaskTrace(id, tab === "trace");
  const checkpoints = useTaskCheckpoints(id, tab === "checkpoints");
  const cancel = useCancelTask();
  const resume = useResumeTask();
  // Live: refresh this task on any task event.
  useInvalidateOnEvent(`tasks:${id}`, [taskKeys.detail(id)]);

  async function onCancel() {
    const ok = await confirm({
      title: "Cancel this task?",
      destructive: true,
      confirmLabel: "Cancel task",
      cancelLabel: "Keep running",
    });
    if (!ok) return;
    try {
      await cancel.mutateAsync(id);
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
                title={`Task ${t.id.slice(0, 8)}`}
                description={t.agent_name ?? "unrouted"}
                actions={
                  <>
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
              </div>

              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="trace">Trace</TabsTrigger>
                  <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
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
                  <QueryState query={trace}>
                    {(data) => (
                      <pre className="overflow-auto rounded-lg border border-border bg-muted p-4 text-xs">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    )}
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
