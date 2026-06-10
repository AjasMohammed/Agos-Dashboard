import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAgent,
  useAgentIdentity,
  useDisconnectAgent,
  useGrantPermission,
  useRevokePermission,
} from "@/api/queries/agents";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { AgentSettingsDialog } from "./agent-settings-dialog";

export function AgentDetailPage() {
  const { name } = useParams({ strict: false }) as { name: string };
  const navigate = useNavigate();
  const query = useAgent(name);
  const identity = useAgentIdentity(name);
  const disconnect = useDisconnectAgent();
  const grant = useGrantPermission(name);
  const revoke = useRevokePermission(name);
  const [newPerm, setNewPerm] = useState("");

  async function onDisconnect() {
    const ok = await confirm({
      title: `Disconnect ${name}?`,
      description: "The agent will be removed from the registry.",
      destructive: true,
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    try {
      await disconnect.mutateAsync(name);
      toast.success(`Disconnected ${name}`);
      navigate({ to: "/agents" });
    } catch (e) {
      toastError(e);
    }
  }

  async function onGrant() {
    const p = newPerm.trim();
    if (!p) return;
    try {
      await grant.mutateAsync(p);
      setNewPerm("");
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
        <Button asChild variant="ghost" size="icon">
          <Link to="/agents">
            <ArrowLeft />
          </Link>
        </Button>
        Agents
      </div>
      <QueryState query={query}>
        {(detail) => {
          const a = detail.summary;
          return (
            <div className="space-y-6 pb-10">
              <PageHeader
                title={a.name}
                description={`${a.provider} · ${a.model}`}
                actions={
                  <>
                    <AgentSettingsDialog name={name} />
                    <Button variant="destructive" onClick={onDisconnect}>
                      <Trash2 /> Disconnect
                    </Button>
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} />
                {a.roles.map((r) => (
                  <Badge key={r} variant="muted">
                    {r}
                  </Badge>
                ))}
                {a.supports_images && <Badge variant="secondary">images</Badge>}
                <span className="text-sm text-muted-foreground">
                  connected {relativeTime(a.connected_at)}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Permissions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex gap-2">
                      <Input
                        value={newPerm}
                        onChange={(e) => setNewPerm(e.target.value)}
                        placeholder="fs:read:/data"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void onGrant();
                          }
                        }}
                      />
                      <Button onClick={onGrant} disabled={!newPerm.trim() || grant.isPending}>
                        Grant
                      </Button>
                    </div>
                    {detail.permissions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No permissions granted.</p>
                    ) : (
                      <ul className="space-y-1">
                        {detail.permissions.map((p) => (
                          <li
                            key={p}
                            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                          >
                            <code className="truncate">{p}</code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void revoke.mutateAsync(p).catch(toastError)}
                            >
                              Revoke
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Recent tasks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {detail.recent_tasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recent tasks.</p>
                    ) : (
                      <ul className="space-y-1">
                        {detail.recent_tasks.map((t) => (
                          <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                            <Link
                              to="/tasks/$id"
                              params={{ id: t.id }}
                              className="truncate hover:underline"
                            >
                              {t.prompt_preview}
                            </Link>
                            <StatusBadge status={t.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              {identity.data && (
                <Card>
                  <CardHeader>
                    <CardTitle>Identity</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Fingerprint</p>
                      <code className="break-all">{identity.data.fingerprint}</code>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <StatusBadge status={identity.data.status} />
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground">Public key</p>
                      <code className="break-all text-xs text-muted-foreground">
                        {identity.data.public_key_hex}
                      </code>
                    </div>
                  </CardContent>
                </Card>
              )}

              {detail.cost_snapshot != null && (
                <Card>
                  <CardHeader>
                    <CardTitle>Cost snapshot</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(detail.cost_snapshot, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
