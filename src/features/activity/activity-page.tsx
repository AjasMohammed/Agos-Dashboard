import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  ListTodo,
  Lock,
  MessagesSquare,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useTasks, taskKeys } from "@/api/queries/tasks";
import { useEscalations } from "@/api/queries/governance";
import { useNotifications } from "@/api/queries/notifications";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/auth/store";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { agentLabel, useAgentNames } from "@/lib/agent-names";
import { buildActivityFeed, type ActivityItem } from "./activity-feed";

const KIND_ICON: Record<ActivityItem["kind"], LucideIcon> = {
  approval: ShieldAlert,
  message: MessagesSquare,
  task: ListTodo,
};

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "approval", label: "Needs you" },
  { id: "message", label: "Messages" },
  { id: "task", label: "Tasks" },
] as const;

function Row({ item, agent }: { item: ActivityItem; agent: string | null }) {
  const Icon = KIND_ICON[item.kind];
  const body = (
    <div className="flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/50">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          item.kind === "approval" ? "text-warning" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        {(agent || item.detail) && (
          <p className="truncate text-xs text-muted-foreground">
            {agent && <span title={item.agentId}>{agent}</span>}
            {agent && item.detail && " · "}
            {item.detail}
          </p>
        )}
      </div>
      {item.status && <StatusBadge status={item.status} />}
      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.at)}</span>
    </div>
  );
  if (!item.to) return body;
  // Section routes are registered dynamically from NAV, so the router's static
  // type union doesn't know them — same string-widening as the nav links.
  return (
    <Link to={item.to as string} params={item.params}>
      {body}
    </Link>
  );
}

export function ActivityPage() {
  const can = useAuthStore((s) => s.can);
  const resolveAgent = useAgentNames();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  // Each source is scope-gated on its own so a partial key still gets a feed.
  // Tasks are not gated here: the route itself is registered behind `tasks:r`
  // (router.tsx + nav.ts), so this page cannot mount without it.
  const canEscalations = can("escalations:r");
  const canNotifications = can("notifications:r");
  const tasks = useTasks({ limit: 25 });
  const escalations = useEscalations({ enabled: canEscalations });
  const notifications = useNotifications({ enabled: canNotifications });
  // This page has no polling fallback of its own — `useDisconnectedPolling`
  // returns false while the socket is healthy — so without this it was frozen
  // exactly when realtime was working. Debounced like the tasks list.
  useInvalidateOnEvent("tasks", [taskKeys.all], { debounceMs: 400 });

  // `isLoading` (pending AND fetching), not `isPending`: a scope-disabled query
  // stays pending forever in React Query v5 and would pin the skeleton on.
  const loading = tasks.isLoading || escalations.isLoading || notifications.isLoading;
  const feed = buildActivityFeed(
    tasks.data?.items ?? [],
    escalations.data ?? [],
    notifications.data ?? [],
  );
  const shown = filter === "all" ? feed : feed.filter((f) => f.kind === filter);
  // A missing scope must read as "you can't see this", not "nothing happened":
  // the tasks 403 used to be swallowed and rendered as the empty state.
  const hidden = [!canEscalations && "approvals", !canNotifications && "messages"].filter(
    Boolean,
  ) as string[];
  // Same rule for a failed source. A 500 on /escalations left `data` undefined
  // and the page cheerfully said "nothing happened" while a blocking approval
  // sat pending — which the kernel auto-denies five minutes later.
  const failed = [
    tasks.isError && "tasks",
    escalations.isError && "approvals",
    notifications.isError && "messages",
  ].filter(Boolean) as string[];
  const retry = () => {
    if (tasks.isError) void tasks.refetch();
    if (escalations.isError) void escalations.refetch();
    if (notifications.isError) void notifications.refetch();
  };

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Everything your assistants did, and anything waiting on you."
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {failed.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Couldn’t load {failed.join(", ")}. Anything waiting on you may be missing from this
            list.
          </span>
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : shown.length === 0 && hidden.length > 0 ? (
        <EmptyState
          icon={Lock}
          title="You can't see this activity"
          description={`This API key has no read access to ${hidden.join(", ")}. Ask for the missing scopes to see the feed.`}
        />
      ) : shown.length === 0 && failed.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Nothing here yet"
          description="Chat with an assistant and its work will show up here."
        />
      ) : (
        <div className="divide-y divide-border pb-10">
          {shown.map((item) => (
            <Row
              key={item.key}
              item={item}
              agent={item.agentId ? agentLabel(resolveAgent(item.agentId), item.agentId) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
