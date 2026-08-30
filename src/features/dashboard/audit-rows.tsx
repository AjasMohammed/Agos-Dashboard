/* eslint-disable react-refresh/only-export-components --
   `auditRowKeys` / `cleanEventType` are pure and exported for unit tests. */
import { useMemo } from "react";
import { EventLogItem, type EventLogEntry } from "@/components/event-log";
import { agentLabel, useAgentNames } from "@/lib/agent-names";

/**
 * Audit `event_type` reaches the panel as the serde-rendered enum name; older
 * kernels (and any path that stringifies the JSON value) hand back
 * `"\"TaskCompleted\""` with the quotes still on. Strip them so both forms
 * render as `TaskCompleted`.
 */
export function cleanEventType(eventType: string): string {
  return eventType.trim().replace(/^"+|"+$/g, "");
}

/**
 * Stable keys for audit rows, which carry no id. `EventLogItem` owns its own
 * `open` state and the list is prepend-ordered, so an index key made a new
 * event inherit an expanded row and show its payload under a different
 * heading. The composite is unique in practice but not by construction — two
 * entries can share timestamp, type and details — so repeats are numbered.
 */
export function auditRowKeys(entries: readonly EventLogEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    const base = `${e.timestamp}|${e.event_type}|${e.agent_id ?? ""}|${e.details.slice(0, 40)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/** Expandable audit rows with the acting agent resolved to a name (id in the tooltip). */
export function AuditRows({ entries }: { entries: readonly EventLogEntry[] }) {
  const resolve = useAgentNames();
  const keys = useMemo(() => auditRowKeys(entries), [entries]);
  return (
    <div className="divide-y divide-border">
      {entries.map((e, i) => (
        <div key={keys[i]} className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <EventLogItem entry={{ ...e, event_type: cleanEventType(e.event_type) }} />
          </div>
          <span
            className="w-28 shrink-0 truncate py-2 text-right text-xs text-muted-foreground"
            title={e.agent_id ?? undefined}
          >
            {agentLabel(resolve(e.agent_id), e.agent_id)}
          </span>
        </div>
      ))}
    </div>
  );
}
