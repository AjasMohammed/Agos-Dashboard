import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, ListTodo, Lock, MessagesSquare, ShieldAlert, type LucideIcon } from "lucide-react";
import { useTasks, taskKeys } from "@/api/queries/tasks";
import { useEscalations } from "@/api/queries/governance";
import { useNotifications } from "@/api/queries/notifications";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/auth/store";
import { absoluteTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { agentLabel, useAgentNames } from "@/lib/agent-names";
import { buildActivityFeed, type ActivityItem } from "./activity-feed";

const KIND_ICON: Record<ActivityItem["kind"], LucideIcon> = {
  approval: ShieldAlert,
  message: MessagesSquare,
  task: ListTodo,
};

const FILTERS = [
  { value: "all", label: "Everything" },
  { value: "approval", label: "Needs you" },
  { value: "message", label: "Messages" },
  { value: "task", label: "Tasks" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

function Row({ item, agent }: { item: ActivityItem; agent: string | null }) {
  const Icon = KIND_ICON[item.kind];
  const body = (
    <div
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 transition-colors duration-100",
        item.to && "hover:bg-muted/50",
      )}
    >
      <Icon
        aria-hidden
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
      <time
        dateTime={item.at}
        title={absoluteTime(item.at)}
        className="tnum shrink-0 text-xs text-muted-foreground"
      >
        {relativeTime(item.at)}
      </time>
    </div>
  );
  if (!item.to) return body;
  // Section routes are registered dynamically from NAV, so the router's static
  // type union doesn't know them — same string-widening as the nav links.
  return (
    <Link to={item.to as string} params={item.params} className="block focus-visible:outline-none focus-visible:bg-muted/60">
      {body}
    </Link>
  );
}

export function ActivityPage() {
  const can = useAuthStore((s) => s.can);
  const resolveAgent = useAgentNames();
  const [filter, setFilter] = useState<Filter>("all");
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
  const counts = {
    all: feed.length,
    approval: feed.filter((f) => f.kind === "approval").length,
    message: feed.filter((f) => f.kind === "message").length,
    task: feed.filter((f) => f.kind === "task").length,
  };
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
        description="Everything your agents did recently, and anything that is waiting on you."
        actions={
          <SegmentedControl
            aria-label="Filter activity"
            options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))}
            value={filter}
            onChange={setFilter}
          />
        }
      />
      {failed.length > 0 && (
        <Callout
          tone="danger"
          role="alert"
          className="mb-4"
          actions={
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          }
        >
          Couldn’t load {failed.join(", ")}. Anything waiting on you may be missing from this list.
        </Callout>
      )}
      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading activity">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
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
          title={filter === "all" ? "Nothing here yet" : "Nothing in this view"}
          description={
            filter === "all"
              ? "Chat with an agent and its work will show up here."
              : "Switch the filter to see the rest of the feed."
          }
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
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
