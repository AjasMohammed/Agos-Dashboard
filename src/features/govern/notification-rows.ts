import type { NotificationSummary } from "@/api/models";

/** Rows the bell panel shows before "View all" takes over. */
export const PANEL_ROWS = 8;

/**
 * The plain rows to list under the bell panel's approval cards.
 *
 * Drops any notification that points at an escalation already rendered as its
 * own card: the approval sink writes BOTH, so without this the same prompt
 * appears twice — once with Approve/Deny, once as dead text.
 */
export function panelRows(
  items: readonly NotificationSummary[],
  pendingEscalationIds: ReadonlySet<number>,
  limit = PANEL_ROWS,
): NotificationSummary[] {
  const kept = items.filter(
    (n) => n.escalation_id == null || !pendingEscalationIds.has(n.escalation_id),
  );
  // A `needs_response` row is an agent blocked waiting on a human. Slicing the
  // combined list would let eight newer informational rows push it out of the
  // panel, so questions are kept whole and only the rest compete for the cap.
  const questions = kept.filter((n) => n.needs_response);
  const rest = kept.filter((n) => !n.needs_response);
  return [...questions, ...rest.slice(0, Math.max(0, limit - questions.length))];
}
