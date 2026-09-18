import { useState } from "react";
import { useAgentMemory, type MemoryTier } from "@/api/queries/agents";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/empty-state";
import { When } from "@/components/when";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

const MEMORY_TIERS: { tier: MemoryTier; label: string }[] = [
  { tier: "episodic", label: "Episodic" },
  { tier: "semantic", label: "Semantic" },
  { tier: "procedural", label: "Procedural" },
];

/** Read-only browse/search of an agent's 3-tier memory. */
export function AgentMemoryCard({ name }: { name: string }) {
  const [tier, setTier] = useState<MemoryTier>("episodic");
  const [q, setQ] = useState("");
  // Debounced so a search does not fire per keystroke; the hook keeps the
  // previous page visible in the meantime (`placeholderData`).
  const query = useAgentMemory(name, tier, useDebounced(q));
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Memory tier"
            options={MEMORY_TIERS.map((t) => ({ value: t.tier, label: t.label }))}
            value={tier}
            onChange={setTier}
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this tier…"
            aria-label={`Search ${tier} memory`}
            className="ml-auto w-full sm:max-w-xs"
          />
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.length === 0}
          empty={
            <EmptyState
              compact
              title={`No ${tier} memory${q.trim() ? " matches" : " yet"}`}
              description={
                q.trim()
                  ? "No item in this tier matches that search."
                  : `${name} writes here as it completes work.`
              }
            />
          }
        >
          {(items) => (
            <div
              // Dimmed, not replaced, while a debounced search resolves — the
              // list stays readable instead of flashing a skeleton per keystroke.
              className={cn(
                "max-h-[28rem] space-y-2 overflow-y-auto transition-opacity",
                query.isPlaceholderData && "opacity-60",
              )}
            >
              {items.map((m) => (
                <div
                  key={`${m.tier}-${m.id}`}
                  className="rounded-md border border-border p-3 transition-colors hover:border-input"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{m.title}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="muted">{m.kind}</Badge>
                      {m.score != null && (
                        <span
                          className="tnum text-xs text-muted-foreground"
                          title="Search relevance"
                        >
                          {m.score.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  {m.content && (
                    <p className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                      {m.content}
                    </p>
                  )}
                  <When iso={m.created_at} className="mt-1 block text-xs text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
