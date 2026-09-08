import { useNavigate, useSearch } from "@tanstack/react-router";
import { ListTodo, Search } from "lucide-react";
import { useTasks, taskKeys, type TaskFilter } from "@/api/queries/tasks";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { absoluteTime, relativeTime } from "@/lib/format";
import { taskTitle } from "@/lib/task-title";
import { RunTaskDialog } from "./run-task-dialog";
import { asTaskStatus, type TaskStatus, type TaskSummary } from "@/api/models";

export interface TaskSearch {
  status?: string;
  q?: string;
  offset?: number;
}

const PAGE = 25;
// Typed against the generated API vocabulary: a chip the API doesn't know is
// now a compile error rather than a filter that silently returns nothing.
const STATUS_CHIPS = ["all", "running", "complete", "failed"] as const satisfies readonly (
  | "all"
  | TaskStatus
)[];
type Chip = (typeof STATUS_CHIPS)[number];
const CHIP_LABEL: Record<Chip, string> = {
  all: "All",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
};

const columns: Column<TaskSummary>[] = [
  {
    key: "prompt",
    header: "Prompt",
    cell: (t) => (
      <span className="line-clamp-1 font-medium" title={t.prompt_preview}>
        {taskTitle(t.prompt_preview)}
      </span>
    ),
  },
  {
    key: "agent",
    header: "Agent",
    headClassName: "w-48",
    cell: (t) => <span className="text-muted-foreground">{t.agent_name ?? "—"}</span>,
  },
  {
    key: "status",
    header: "Status",
    headClassName: "w-32",
    cell: (t) => <StatusBadge status={t.status} />,
  },
  {
    key: "created",
    header: "Created",
    headClassName: "w-36",
    cell: (t) => (
      <time dateTime={t.created_at} title={absoluteTime(t.created_at)} className="text-muted-foreground">
        {relativeTime(t.created_at)}
      </time>
    ),
  },
];

export function TasksPage() {
  const search = useSearch({ strict: false }) as TaskSearch;
  const navigate = useNavigate();
  const offset = search.offset ?? 0;
  const q = (search.q ?? "").toLowerCase();
  // `asTaskStatus` also maps the panel's old `completed` spelling. A status
  // with no chip (queued, waiting…) still filters the list — it just shows no
  // chip pressed, so a deep link keeps working.
  const status = asTaskStatus(search.status);
  const chip = (status ?? "all") as Chip;
  const chipLabel = CHIP_LABEL[chip] ?? chip;
  const filter: TaskFilter = { status, limit: PAGE, offset };
  const query = useTasks(filter);
  useInvalidateOnEvent("tasks", [taskKeys.all], { debounceMs: 400 });

  // `replace` for search-as-you-type: `navigate` pushes by default, so typing
  // "deploy" left six history entries and Back needed six presses. Chips and
  // the pager stay pushes — those are deliberate navigations worth going back to.
  const setSearch = (patch: Partial<TaskSearch>, replace = false) =>
    navigate({ to: "/tasks", search: { ...search, ...patch }, replace });

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Every task run by an agent, newest first. Open one to see its trace and checkpoints."
        actions={<RunTaskDialog />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Filter by status"
          options={STATUS_CHIPS.map((s) => ({ value: s, label: CHIP_LABEL[s] }))}
          value={chip}
          onChange={(s) => setSearch({ status: s, offset: 0 })}
        />
        <div className="relative ml-auto w-full sm:w-72">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ q: e.target.value }, true)}
            placeholder="Filter prompts on this page…"
            aria-label="Filter prompts"
            className="pl-8"
          />
        </div>
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            icon={ListTodo}
            title={chip === "all" ? "No tasks yet" : `No ${chipLabel.toLowerCase()} tasks`}
            description={
              chip === "all"
                ? "Run a task and it will show up here with its status and trace."
                : "Try another status filter."
            }
            action={chip === "all" ? <RunTaskDialog /> : undefined}
          />
        }
      >
        {(data) => {
          const rows = q
            ? data.items.filter((t) => t.prompt_preview.toLowerCase().includes(q))
            : data.items;
          // `meta.total` can lag the rows (or be 0 from an older kernel) — never
          // claim fewer tasks than are on screen.
          const total = Math.max(data.total, offset + data.items.length);
          const from = offset + 1;
          const to = offset + data.items.length;
          return (
            <DataTable
              columns={columns}
              rows={rows}
              getRowId={(t) => t.id}
              onRowClick={(t) => navigate({ to: "/tasks/$id", params: { id: t.id } })}
              emptyMessage="No prompts on this page match the filter."
              footer={
                q ? (
                  // The prompt filter is applied client-side to the current page
                  // only, so the server total / pager don't apply — show an honest count.
                  <span>
                    {rows.length} of {data.items.length} on this page match · clear the filter to
                    page through all {data.total}
                  </span>
                ) : (
                  <>
                    <span className="tnum">
                      {total === 0 ? "0 tasks" : `${from}–${to} of ${total}`}
                    </span>
                    <span className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={offset === 0}
                        onClick={() => setSearch({ offset: Math.max(0, offset - PAGE) })}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={offset + PAGE >= total}
                        onClick={() => setSearch({ offset: offset + PAGE })}
                      >
                        Next
                      </Button>
                    </span>
                  </>
                )
              }
            />
          );
        }}
      </QueryState>
    </div>
  );
}
