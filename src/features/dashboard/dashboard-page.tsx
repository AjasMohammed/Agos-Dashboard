import { Link } from "@tanstack/react-router";
import { Bot, Clock, ListTodo, Wrench, Activity, type LucideIcon } from "lucide-react";
import { useDashboard, dashboardKey } from "@/api/queries/dashboard";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { AnimatedNumber, Stagger, StaggerItem } from "@/components/motion";
import { EventLogItem } from "@/components/event-log";

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

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="hover:shadow-glow">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="truncate font-mono text-xl font-semibold">
            {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
          </p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
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
        description="Live overview of your AgentOS instance."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/agents">Connect agent</Link>
            </Button>
            <Button asChild>
              <Link to="/tasks">New task</Link>
            </Button>
          </>
        }
      />

      <QueryState query={query}>
        {(d) => (
          <Stagger className="space-y-6 pb-10">
            <StaggerItem className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Clock} label="Uptime" value={formatUptime(d.uptime_secs)} />
              <StatCard
                icon={Bot}
                label="Agents"
                value={`${d.online_agents.length} / ${d.agent_count}`}
                hint="online / total"
              />
              <StatCard icon={Wrench} label="Tools" value={d.tool_count} />
              <StatCard
                icon={ListTodo}
                label="Tasks running"
                value={d.task_counts.running}
                hint={`${d.task_counts.total} total · ${d.background_task_count} background`}
              />
            </StaggerItem>

            <StaggerItem className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Task status</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["Total", d.task_counts.total],
                      ["Running", d.task_counts.running],
                      ["Completed", d.task_counts.completed],
                      ["Failed", d.task_counts.failed],
                    ] as const
                  ).map(([label, count]) => (
                    <div
                      key={label}
                      className="rounded-md border border-border bg-background/50 p-3 transition-colors hover:border-primary/40"
                    >
                      <p className="font-mono text-2xl font-semibold">
                        <AnimatedNumber value={count} />
                      </p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Online agents</CardTitle>
                </CardHeader>
                <CardContent>
                  {d.online_agents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No agents online.</p>
                  ) : (
                    <ul className="space-y-2">
                      {d.online_agents.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2">
                          <Link
                            to="/agents/$name"
                            params={{ name: a.name }}
                            className="truncate font-medium hover:text-primary hover:underline"
                          >
                            {a.name}
                          </Link>
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
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
            </StaggerItem>

            <StaggerItem>
              <Card>
                <CardHeader>
                  <CardTitle>Recent activity</CardTitle>
                </CardHeader>
                <CardContent>
                  {d.recent_audit.length === 0 ? (
                    <EmptyState icon={Activity} title="No recent activity" />
                  ) : (
                    <div className="divide-y divide-border">
                      {d.recent_audit.slice(0, 12).map((e, i) => (
                        <EventLogItem key={i} entry={e} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </StaggerItem>
          </Stagger>
        )}
      </QueryState>
    </div>
  );
}
