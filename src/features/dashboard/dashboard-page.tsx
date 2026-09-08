import { Link } from "@tanstack/react-router";
import { Activity, Bot, Clock, ListTodo, Wrench } from "lucide-react";
import { useDashboard, dashboardKey } from "@/api/queries/dashboard";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { AuditRows } from "./audit-rows";

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const days = Math.floor(secs / 86400);
  const hours = Math.floor(secs / 3600) % 24;
  const mins = Math.floor(secs / 60) % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins && !days) parts.push(`${mins}m`);
  return parts.join(" ") || `${secs}s`;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading dashboard">
      <StatGrid min={200}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px]" />
        ))}
      </StatGrid>
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function DashboardPage() {
  const query = useDashboard();
  // Live: task/agent events refresh the cards (debounced to avoid refetch storms).
  useInvalidateOnEvent("tasks", [dashboardKey], { debounceMs: 500 });
  useInvalidateOnEvent("agents", [dashboardKey], { debounceMs: 500 });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="A live overview of your agents, tasks and recent kernel activity."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/agents">Add assistant</Link>
            </Button>
            <Button asChild>
              <Link to="/tasks">New task</Link>
            </Button>
          </>
        }
      />

      <QueryState query={query} skeleton={<DashboardSkeleton />}>
        {(d) => {
          const online = d.online_agents.length;
          const offline = Math.max(0, d.agent_count - online);
          return (
            <div className="space-y-5">
              <StatGrid min={200}>
                <Stat icon={Clock} label="Uptime" value={formatUptime(d.uptime_secs)} hint="Since the kernel started" />
                <Stat
                  icon={Bot}
                  label="Agents online"
                  value={`${online} / ${d.agent_count}`}
                  hint={offline === 0 ? "Every agent is connected" : `${offline} offline`}
                  tone={offline > 0 && online === 0 ? "warning" : undefined}
                />
                <Stat icon={Wrench} label="Tools" value={d.tool_count} hint="Installed and callable" />
                <Stat
                  icon={ListTodo}
                  label="Tasks running"
                  value={d.task_counts.running}
                  hint={`${d.task_counts.total} total · ${d.background_task_count} in background`}
                  tone={d.task_counts.running > 0 ? "info" : undefined}
                />
              </StatGrid>

              <div className="grid gap-5 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Task status</CardTitle>
                    <CardDescription>Counts across every agent since the kernel started.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <StatGrid min={110}>
                      <Stat size="sm" label="Total" value={d.task_counts.total} />
                      <Stat size="sm" label="Running" value={d.task_counts.running} tone="info" />
                      <Stat size="sm" label="Completed" value={d.task_counts.completed} tone="success" />
                      <Stat
                        size="sm"
                        label="Failed"
                        value={d.task_counts.failed}
                        tone={d.task_counts.failed > 0 ? "danger" : undefined}
                      />
                    </StatGrid>
                    <Button asChild variant="link" size="sm" className="mt-3">
                      <Link to="/tasks">View all tasks</Link>
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Online agents</CardTitle>
                    <CardDescription>Agents connected right now, with the model behind each.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {online === 0 ? (
                      <EmptyState
                        compact
                        icon={Bot}
                        title="No agents online"
                        description="Connect an agent to start running tasks."
                        action={
                          <Button asChild size="sm" variant="outline">
                            <Link to="/agents">Add assistant</Link>
                          </Button>
                        }
                      />
                    ) : (
                      <ul className="divide-y divide-border">
                        {d.online_agents.map((a) => (
                          <li
                            key={a.id}
                            className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                          >
                            <Link
                              to="/agents/$name"
                              params={{ name: a.name }}
                              className="min-w-0 truncate text-sm font-medium hover:underline"
                            >
                              {a.name}
                            </Link>
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-mono text-xs text-muted-foreground">
                                {a.model}
                              </span>
                              <StatusBadge status={a.status} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle>Recent activity</CardTitle>
                    <CardDescription>The latest audit events recorded by the kernel.</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={"/audit" as string}>Open audit log</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {d.recent_audit.length === 0 ? (
                    <EmptyState compact icon={Activity} title="No recent activity" />
                  ) : (
                    <AuditRows entries={d.recent_audit.slice(0, 12)} />
                  )}
                </CardContent>
              </Card>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
