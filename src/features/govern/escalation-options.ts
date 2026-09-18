import type { Escalation } from "@/api/models";

/**
 * Pure helpers over an escalation's operator-facing options.
 *
 * Their own module because the chat approval card and the govern queue must
 * agree on them exactly: both render buttons from agent-controlled option text,
 * and both decide whether "approve & always" is real. A second copy in one of
 * them is how the two surfaces drift apart.
 */

export const escOptions = (e: Escalation) => e.options ?? ["approve", "deny"];

/**
 * The escalation's OWN spelling of `decision`, or `undefined` when it doesn't
 * offer it. Matching is case/space-insensitive — an agent that emits
 * `["Approve", "Deny"]` used to be unresolvable in bulk (every row landed in
 * `skipped`) while its per-row buttons worked — but the original string is what
 * comes back, because the kernel matches the option text it handed out.
 */
export const matchOption = (e: Escalation, decision: string): string | undefined => {
  const want = decision.trim().toLowerCase();
  return escOptions(e).find((o) => o.trim().toLowerCase() === want);
};

/**
 * `ApprovalHook`'s `TOOL_APPROVAL_KIND`
 * (`crates/agentos-kernel/src/approval_policy_store.rs`). Not in the generated
 * schema — escalation `metadata` is an opaque object — so it is pinned here.
 */
const TOOL_APPROVAL_KIND = "tool_approval";

/**
 * Whether "approve & always" is worth offering on this row.
 *
 * Only the kernel's own tool-approval escalations carry the metadata
 * (`tool_name`, `path`, `risk_class`) that a standing grant is minted from; on
 * anything else `remember` is silently a no-op, so the button would promise
 * something that never happens. It also requires the row to actually offer
 * "approve" — an agent-authored escalation may only offer its own verbs, and
 * resolving it with a decision it never listed is not this button's call to
 * make. The kernel still has the final say — it refuses control-plane tools and
 * exec tools it cannot scope by path — and says so in `remember_note`, which is
 * what the caller reports.
 */
export const canRemember = (e: Escalation): boolean =>
  matchOption(e, "approve") !== undefined &&
  (e.metadata as { kind?: unknown } | null)?.kind === TOOL_APPROVAL_KIND;
