import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { useAgentIdentity } from "@/api/queries/agents";
import { QueryState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { When } from "@/components/when";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/** One `dt`/`dd` pair; `copy` adds a button that puts the full value on the clipboard. */
function Row({
  label,
  value,
  copy,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  copy?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className={mono ? "truncate font-mono text-xs" : "truncate text-sm"}>{value}</span>
        {copy && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => void copyText(copy, label)}
          >
            <Copy className="size-3" />
          </Button>
        )}
      </dd>
    </div>
  );
}

/**
 * The agent's cryptographic identity. The public key is the longest and least
 * often read value on the page, so it is folded away rather than given a column.
 */
export function AgentIdentityCard({ name }: { name: string }) {
  const query = useAgentIdentity(name);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
      </CardHeader>
      <CardContent>
        {/* `QueryState`, not `if (!data) return null`: in a column between two
            other cards, a silent disappearance reads as "this agent has no
            identity" rather than "the request failed", and offers no retry. */}
        <QueryState query={query}>
          {(data) => (
            <>
              <dl className="divide-y divide-border">
                <Row label="Fingerprint" value={data.fingerprint ?? "—"} copy={data.fingerprint} />
                <Row label="Agent id" value={data.id} copy={data.id} />
                <Row label="Status" value={<StatusBadge status={data.status} />} mono={false} />
                <Row label="Created" value={<When iso={data.created_at} />} mono={false} />
                <Row label="Last active" value={<When iso={data.last_active} />} mono={false} />
              </dl>
              {data.public_key_hex && (
                <details className="mt-3">
                  <summary className="cursor-pointer select-none text-xs text-muted-foreground transition-colors hover:text-foreground">
                    Public key
                  </summary>
                  <div className="mt-2 flex items-start gap-1">
                    <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-surface p-3 font-mono text-xs text-muted-foreground">
                      {data.public_key_hex}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      aria-label="Copy public key"
                      onClick={() => void copyText(data.public_key_hex!, "Public key")}
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                </details>
              )}
            </>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
