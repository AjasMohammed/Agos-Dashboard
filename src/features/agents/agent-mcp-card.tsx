import { toast } from "sonner";
import { useGrantAgentPermission, useRevokePermission } from "@/api/queries/agents";
import { useMcpServers } from "@/api/queries/extensibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QueryState } from "@/components/query-state";
import { toastError } from "@/lib/errors";
import { coveringGrant, isMcpResource, parsePermission } from "./permission-catalog";

/**
 * MCP access is per server: granting one gives the agent every tool that
 * server exposes. Ungranted servers are invisible to the agent.
 */
export function AgentMcpCard({ name, granted }: { name: string; granted: string[] }) {
  const servers = useMcpServers();
  const grant = useGrantAgentPermission();
  const revoke = useRevokePermission(name);
  const busy = grant.isPending || revoke.isPending;

  // A detach keeps the agent's grant, and re-attaching re-arms it — so grants
  // for servers that are gone stay listed and revocable.
  const orphansOf = (list: { permission: string }[]) =>
    granted.filter(
      (p) =>
        isMcpResource(parsePermission(p)?.resource ?? "") && !list.some((s) => s.permission === p),
    );

  async function toggle(server: string, permission: string, on: boolean) {
    if (busy) return;
    try {
      if (on) await grant.mutateAsync({ name, permission });
      else await revoke.mutateAsync(permission);
      toast.success(`${on ? "Granted" : "Revoked"} ${server}`);
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP servers</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState query={servers}>
          {(list) =>
            list.length === 0 && orphansOf(list).length === 0 ? (
              <p className="text-sm text-muted-foreground">No MCP servers attached.</p>
            ) : (
              <ul className="space-y-1">
                {list.map((s) => {
                  const via = coveringGrant(granted, s.permission);
                  return (
                    <li
                      key={s.name}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <code className="truncate">{s.name}</code>
                        <Badge variant="outline">{s.tool_count} tools</Badge>
                      </span>
                      {via && via !== s.permission ? (
                        <span className="text-muted-foreground">
                          via <code>{via}</code>
                        </span>
                      ) : (
                        <Button
                          variant={via ? "ghost" : "outline"}
                          size="sm"
                          disabled={busy}
                          aria-label={`${via ? "Revoke" : "Grant"} MCP server ${s.name}`}
                          onClick={() => void toggle(s.name, s.permission, !via)}
                        >
                          {via ? "Revoke" : "Grant"}
                        </Button>
                      )}
                    </li>
                  );
                })}
                {orphansOf(list).map((p) => (
                  <li
                    key={p}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <code className="truncate">{p}</code>
                      <Badge variant="muted">not attached</Badge>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Revoke ${p}`}
                      onClick={() => void toggle(p, p, false)}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      </CardContent>
    </Card>
  );
}
