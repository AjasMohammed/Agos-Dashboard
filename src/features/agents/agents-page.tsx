import { useNavigate } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useAgents, agentKeys } from "@/api/queries/agents";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import { ConnectAgentDialog } from "./connect-agent-dialog";
import type { AgentSummary } from "@/api/models";

const columns: Column<AgentSummary>[] = [
  { key: "name", header: "Name", cell: (a) => <span className="font-medium">{a.name}</span> },
  { key: "provider", header: "Provider", cell: (a) => a.provider },
  {
    key: "model",
    header: "Model",
    cell: (a) => <span className="text-muted-foreground">{a.model}</span>,
  },
  { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
  {
    key: "roles",
    header: "Roles",
    cell: (a) =>
      a.roles.length ? (
        <span className="flex flex-wrap gap-1">
          {a.roles.map((r) => (
            <Badge key={r} variant="muted">
              {r}
            </Badge>
          ))}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "images",
    header: "Vision",
    cell: (a) =>
      a.supports_images ? (
        <Badge variant="secondary">images</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "connected",
    header: "Connected",
    cell: (a) => <span className="text-muted-foreground">{relativeTime(a.connected_at)}</span>,
  },
];

export function AgentsPage() {
  const query = useAgents();
  const navigate = useNavigate();
  useInvalidateOnEvent("agents", [agentKeys.all]);

  return (
    <div>
      <PageHeader
        title="Agents"
        description="LLM agents registered with the kernel."
        actions={<ConnectAgentDialog />}
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={Bot}
            title="No agents connected"
            description="Connect an agent to start running tasks."
            action={<ConnectAgentDialog />}
          />
        }
      >
        {(agents) => (
          <DataTable
            columns={columns}
            rows={agents}
            getRowId={(a) => a.id}
            onRowClick={(a) => navigate({ to: "/agents/$name", params: { name: a.name } })}
          />
        )}
      </QueryState>
    </div>
  );
}
