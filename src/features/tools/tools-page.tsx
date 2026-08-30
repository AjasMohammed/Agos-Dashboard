import { useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { toast } from "sonner";
import { useTools, useRemoveTool } from "@/api/queries/tools";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { InstallToolDialog } from "./install-tool-dialog";
import type { ToolSummary } from "@/api/models";

/** exec/control-plane tools prompt for approval; make them stand out. */
const RISK_CLASS: Record<string, string> = {
  exec_capable: "border-destructive/50 text-destructive",
  control_plane: "border-destructive/50 text-destructive",
  write_scoped: "border-warning/50 text-warning",
};

/**
 * Row detail. `GET /tools/{name}` returns the same `ApiToolSummary` as the
 * list, so the row we already hold is the whole record — no second fetch.
 */
function ToolDetailDialog({
  tool,
  open,
  onOpenChange,
}: {
  tool: ToolSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rows: [string, ReactNode][] = tool
    ? [
        ["Version", tool.version],
        ["Author", tool.author],
        ["Status", <StatusBadge key="s" status={tool.status} />],
        ["Trust tier", <Badge key="t" variant="outline">{tool.trust_tier}</Badge>],
        [
          "Risk class",
          tool.risk_class ? (
            <Badge key="r" variant="outline" className={RISK_CLASS[tool.risk_class]}>
              {tool.risk_class.replace("_", " ")}
            </Badge>
          ) : (
            "—"
          ),
        ],
        [
          "Permissions",
          tool.permissions?.length ? (
            <span key="p" className="flex flex-wrap gap-1">
              {tool.permissions.map((p) => (
                <Badge key={p} variant="muted" className="font-mono">
                  {p}
                </Badge>
              ))}
            </span>
          ) : (
            "none"
          ),
        ],
        ["Id", <span key="i" className="font-mono text-xs">{tool.id}</span>],
      ]
    : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono">{tool?.name}</DialogTitle>
          <DialogDescription>{tool?.description || "No description."}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export function ToolsPage() {
  const query = useTools();
  const remove = useRemoveTool();
  const [q, setQ] = useState("");
  // `open` is separate from `selected` so the dialog keeps its content through
  // the close animation (same shape as the agent-chats detail dialog).
  const [selected, setSelected] = useState<ToolSummary | null>(null);
  const [open, setOpen] = useState(false);

  async function onRemove(name: string) {
    const ok = await confirm({
      title: `Remove ${name}?`,
      description: "The tool will be unregistered from the kernel.",
      destructive: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(name);
      toast.success(`Removed ${name}`);
    } catch (e) {
      toastError(e);
    }
  }

  const columns: Column<ToolSummary>[] = [
    { key: "name", header: "Name", cell: (t) => <span className="font-medium">{t.name}</span> },
    {
      key: "version",
      header: "Version",
      cell: (t) => <span className="text-muted-foreground">{t.version}</span>,
    },
    {
      key: "description",
      header: "Description",
      cell: (t) => <span className="line-clamp-1 text-muted-foreground">{t.description}</span>,
    },
    { key: "author", header: "Author", cell: (t) => t.author },
    {
      key: "trust",
      header: "Trust",
      cell: (t) => <Badge variant="outline">{t.trust_tier}</Badge>,
    },
    {
      key: "risk",
      header: "Risk",
      cell: (t) =>
        t.risk_class ? (
          <Badge variant="outline" className={RISK_CLASS[t.risk_class]} title="Approval risk class">
            {t.risk_class.replace("_", " ")}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
    {
      key: "actions",
      header: "",
      headClassName: "w-0",
      cell: (t) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation(); // row click opens the detail dialog
            void onRemove(t.name);
          }}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Tools"
        description="Installed tools available to agents."
        actions={<InstallToolDialog />}
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={Wrench}
            title="No tools installed"
            description="Install a tool from a manifest path."
            action={<InstallToolDialog />}
          />
        }
      >
        {(tools) => {
          const needle = q.trim().toLowerCase();
          const rows = needle
            ? tools.filter(
                (t) =>
                  t.name.toLowerCase().includes(needle) ||
                  t.description.toLowerCase().includes(needle) ||
                  (t.risk_class ?? "").replace("_", " ").includes(needle),
              )
            : tools;
          return (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter by name, description or risk…"
                  className="max-w-sm"
                />
                <span className="text-sm text-muted-foreground">
                  {rows.length} / {tools.length}
                </span>
              </div>
              {rows.length === 0 ? (
                <EmptyState icon={Wrench} title="No tools match" description="Try a different filter." />
              ) : (
                <DataTable
                  columns={columns}
                  rows={rows}
                  getRowId={(t) => t.id}
                  onRowClick={(t) => {
                    setSelected(t);
                    setOpen(true);
                  }}
                />
              )}
            </div>
          );
        }}
      </QueryState>
      <ToolDetailDialog tool={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
