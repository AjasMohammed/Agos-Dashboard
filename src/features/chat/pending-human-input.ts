import type { Escalation, NotificationSummary } from "@/api/models";
import { streamTools, type ChatStream } from "./stream-store";

export interface PendingHumanInput {
  approvals: { escalation: Escalation; toolName?: string }[];
  questions: NotificationSummary[];
}

/** Pure matcher — which records belong to this stream's running calls. */
export function pendingHumanInput(
  stream: ChatStream,
  escalations: readonly Escalation[],
  notifications: readonly NotificationSummary[],
): PendingHumanInput {
  const running = streamTools(stream).filter((t) => t.success === undefined && t.taskId);
  // Every call in one LLM iteration shares the turn's task id, so a task id maps
  // to a tool name only when exactly one call is in flight under it. Anything
  // else is ambiguous and must not be attributed to a named tool.
  const namesByTask = new Map<string, string[]>();
  for (const t of running) {
    const id = t.taskId as string;
    namesByTask.set(id, [...(namesByTask.get(id) ?? []), t.name]);
  }
  const byTask = new Map(
    [...namesByTask].map(([id, names]) => [id, names.length === 1 ? names[0] : undefined]),
  );
  return {
    approvals: escalations
      .filter((e) => !e.resolved && byTask.has(e.task_id))
      .map((e) => ({ escalation: e, toolName: byTask.get(e.task_id) })),
    questions: notifications.filter(
      (n) => n.needs_response && n.task_id != null && byTask.has(n.task_id),
    ),
  };
}
