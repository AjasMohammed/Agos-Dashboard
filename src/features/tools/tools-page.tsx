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
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { InstallToolDialog } from "./install-tool-dialog";
import type { ToolSummary } from "@/api/models";

export function ToolsPage() {
  const query = useTools();
  const remove = useRemoveTool();

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
    { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
    {
      key: "actions",
      header: "",
      headClassName: "w-0",
      cell: (t) => (
        <Button variant="ghost" size="sm" onClick={() => onRemove(t.name)}>
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
        {(tools) => <DataTable columns={columns} rows={tools} getRowId={(t) => t.id} />}
      </QueryState>
    </div>
  );
}
