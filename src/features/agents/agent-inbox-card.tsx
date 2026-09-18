import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { CornerDownRight, ShieldCheck } from "lucide-react";
import { useAgentInbox, useAgents } from "@/api/queries/agents";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/empty-state";
import { When } from "@/components/when";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Resolve an inbox participant to a linkable agent.
 *
 * `from` is a bare agent UUID; `to` is one of the kernel's four rendered forms
 * — `direct:<uuid>`, `name:<n>`, `group:<id>` or `broadcast` (see
 * `ApiInboxMessage.to` in the contract). Agent ids are matched against the
 * agent list the page has already cached; an id with no match (a removed
 * agent) keeps its short hex, because there is no endpoint to resolve one and
 * inventing a name would be a lie. The short hex is taken from the
 * *identifier*, never from the whole prefixed string — slicing `group:ops-team`
 * to `group:op` would throw away the only part that identifies anything.
 */
function useParticipants() {
  const agents = useAgents();
  return useMemo(() => {
    const byId = new Map((agents.data ?? []).map((a) => [a.id, a.name]));
    const known = new Set((agents.data ?? []).map((a) => a.name));
    return (raw: string): { label: string; name?: string } => {
      if (raw === "broadcast") return { label: "everyone" };
      const sep = raw.indexOf(":");
      const kind = sep === -1 ? "" : raw.slice(0, sep);
      const id = sep === -1 ? raw : raw.slice(sep + 1);
      if (kind === "group") return { label: `group ${id}` };
      const name = kind === "name" ? id : byId.get(id);
      if (name) return known.has(name) ? { label: name, name } : { label: name };
      return { label: id.slice(0, 8) };
    };
  }, [agents.data]);
}

function Participant({ label, name }: { label: string; name?: string }) {
  if (!name) return <code className="min-w-0 truncate text-xs">{label}</code>;
  return (
    <Link
      to="/agents/$name"
      params={{ name }}
      className="min-w-0 truncate font-medium hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  );
}

/** Read-only agent-to-agent message timeline. */
export function AgentInboxCard({ name }: { name: string }) {
  const query = useAgentInbox(name);
  const resolve = useParticipants();
  return (
    <Card>
      <CardContent className="p-4">
        <QueryState
          query={query}
          isEmpty={(d) => d.length === 0}
          empty={
            <EmptyState
              compact
              title="No messages yet"
              description={`Messages other agents send ${name} land here.`}
            />
          }
        >
          {(items) => (
            <div className="max-h-[28rem] space-y-2 overflow-y-auto">
              {items.map((m) => {
                const from = resolve(m.from);
                const to = resolve(m.to);
                return (
                  <div
                    key={m.id}
                    className="rounded-md border border-border p-3 transition-colors hover:border-input"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-1.5 text-sm">
                        <Participant {...from} />
                        <span aria-hidden className="text-muted-foreground">
                          →
                        </span>
                        <Participant {...to} />
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="muted">{m.kind}</Badge>
                        {m.signed && (
                          <ShieldCheck aria-label="Signed" className="size-3.5 text-success" />
                        )}
                      </div>
                    </div>
                    {m.preview && (
                      <p className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                        {m.preview}
                      </p>
                    )}
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <When iso={m.timestamp} />
                      {m.reply_to && (
                        <span className="inline-flex items-center gap-1">
                          <CornerDownRight aria-hidden className="size-3" /> reply
                        </span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
