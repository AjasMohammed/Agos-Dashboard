import { useNavigate, useSearch } from "@tanstack/react-router";
import { ListTodo } from "lucide-react";
import { useTasks, taskKeys, type TaskFilter } from "@/api/queries/tasks";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RunTaskDialog } from "./run-task-dialog";
import type { TaskSummary } from "@/api/models";

export interface TaskSearch {
  status?: string;
  q?: string;
  offset?: number;
}

const PAGE = 25;
const STATUS_CHIPS = ["all", "running", "completed", "failed"] as const;

const columns: Column<TaskSummary>[] = [
  {
    key: "prompt",
    header: "Prompt",
    cell: (t) => <span className="line-clamp-1 font-medium">{t.prompt_preview}</span>,
  },
  {
    key: "agent",
    header: "Agent",
    cell: (t) => <span className="text-muted-foreground">{t.agent_name ?? "—"}</span>,
  },
  { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
  {
    key: "created",
    header: "Created",
    cell: (t) => <span className="text-muted-foreground">{relativeTime(t.created_at)}</span>,
  },
];

export function TasksPage() {
  const search = useSearch({ strict: false }) as TaskSearch;
  const navigate = useNavigate();
  const offset = search.offset ?? 0;
  const q = (search.q ?? "").toLowerCase();
  const filter: TaskFilter = {
    status: search.status && search.status !== "all" ? search.status : undefined,
    limit: PAGE,
    offset,
  };
  const query = useTasks(filter);
  useInvalidateOnEvent("tasks", [taskKeys.all], { debounceMs: 400 });

  const setSearch = (patch: Partial<TaskSearch>) =>
    navigate({ to: "/tasks", search: { ...search, ...patch } });

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Task lifecycle across all agents."
        actions={<RunTaskDialog />}
      />
      <div className="flex flex-wrap items-center gap-2 pb-4">
        {STATUS_CHIPS.map((s) => (
          <button
            key={s}
            onClick={() => setSearch({ status: s, offset: 0 })}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
              (search.status ?? "all") === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
        <Input
          value={search.q ?? ""}
          onChange={(e) => setSearch({ q: e.target.value })}
          placeholder="Filter prompt…"
          className="ml-auto max-w-xs"
        />
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            icon={ListTodo}
            title="No tasks"
            description="Run a task to see it here."
            action={<RunTaskDialog />}
          />
        }
      >
        {(data) => {
          const rows = q
            ? data.items.filter((t) => t.prompt_preview.toLowerCase().includes(q))
            : data.items;
          return (
            <div className="space-y-3">
              <DataTable
                columns={columns}
                rows={rows}
                getRowId={(t) => t.id}
                onRowClick={(t) => navigate({ to: "/tasks/$id", params: { id: t.id } })}
              />
              {q ? (
                // The prompt filter is applied client-side to the current page only,
                // so the server total / pager don't apply — show an honest count.
                <p className="text-sm text-muted-foreground">
                  {rows.length} match on this page (clear the filter to paginate all{" "}
                  {data.total})
                </p>
              ) : (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{data.total} total</span>
                  <span className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset === 0}
                      onClick={() => setSearch({ offset: Math.max(0, offset - PAGE) })}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + PAGE >= data.total}
                      onClick={() => setSearch({ offset: offset + PAGE })}
                    >
                      Next
                    </Button>
                  </span>
                </div>
              )}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
