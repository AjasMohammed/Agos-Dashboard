import type { Escalation, NotificationSummary, TaskSummary } from "@/api/models";

/** One row in the merged activity timeline. */
export interface ActivityItem {
  key: string;
  kind: "approval" | "message" | "task";
  title: string;
  detail?: string;
  status?: string;
  at: string;
  /** Route to open when the row is clicked, if any. */
  to?: string;
  params?: Record<string, string>;
  /** Acting agent (UUID) — resolved to a name at render time. */
  agentId?: string;
}

const UUID = /^(?:agent\s+)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The agent id inside a notification `from` label, or `null` for a non-agent
 * source. The API renders `NotificationSource::Agent(id)` as `"Agent <uuid>"`
 * (kernel_impl.rs) and `Kernel` / `System` as plain words.
 */
export function senderAgentId(from: string | null | undefined): string | null {
  const m = from?.trim().match(UUID);
  return m ? m[1] : null;
}

/**
 * Merge the three "something happened / something needs you" sources into one
 * reverse-chronological list. Pure so it can be tested without the network.
 *
 * ponytail: sorts the three already-fetched pages in memory — no server-side
 * merged feed. Add one only if the pages get big enough to page through.
 */
export function buildActivityFeed(
  tasks: readonly TaskSummary[],
  escalations: readonly Escalation[],
  notifications: readonly NotificationSummary[],
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...escalations
      .filter((e) => !e.resolved)
      .map((e) => ({
        key: `esc-${e.id}`,
        kind: "approval" as const,
        title: e.decision_point || "An assistant needs your approval",
        detail: e.context_summary || undefined,
        status: e.urgency,
        at: e.created_at,
        to: "/escalations",
        agentId: e.agent_id || undefined,
      })),
    ...notifications.map((n) => ({
      key: `note-${n.id}`,
      kind: "message" as const,
      title: n.subject,
      detail: n.body || undefined,
      status: n.needs_response ? "needs reply" : undefined,
      at: n.timestamp,
      to: "/notifications",
      agentId: senderAgentId(n.from) ?? undefined,
    })),
    ...tasks.map((t) => ({
      key: `task-${t.id}`,
      kind: "task" as const,
      title: t.prompt_preview || "Task",
      detail: t.error ?? t.agent_name ?? undefined,
      status: t.status,
      at: t.completed_at ?? t.created_at,
      to: "/tasks/$id",
      params: { id: t.id },
    })),
  ];
  // Newest first; an unparseable/missing timestamp sorts last rather than
  // throwing the whole feed into a random order.
  return items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
