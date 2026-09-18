import { useState } from "react";
import { MessageCircleQuestion, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useEscalations, useResolveEscalation } from "@/api/queries/governance";
import { useNotifications, useRespondNotification } from "@/api/queries/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastError } from "@/lib/errors";
import { canRemember, escOptions, matchOption } from "@/features/govern/escalation-options";
import { pendingHumanInput } from "./pending-human-input";
import type { Escalation, NotificationSummary } from "@/api/models";
import { streamTools, type ChatStream } from "./stream-store";
import { useAuthStore } from "@/auth/store";

/**
 * Inline approvals and questions for the tool calls of a live chat turn.
 *
 * SECURITY: every card here is built from an escalation / notification record
 * fetched from the API and matched by the kernel-minted per-turn task id that
 * arrived on `tool_start`. Nothing in the agent's streamed text can create,
 * label, or resolve a card — the model cannot fabricate an approval prompt.
 *
 * ponytail: polls REST while a call is in flight; swap for a WS `escalations`
 * channel if/when the kernel emits one.
 */
const POLL_MS = 1500;

export function ApprovalCard({ escalation: e, toolName }: { escalation: Escalation; toolName?: string }) {
  const resolve = useResolveEscalation();
  // Minting the standing grant needs `approvals:w` on top of `escalations:w`,
  // and the kernel checks it BEFORE resolving — so on a key without it the
  // click 403s and the escalation stays pending, losing the approval too.
  const canGrant = useAuthStore((s) => s.can("approvals:w"));
  const busy = resolve.isPending;
  const id = String(e.id);

  function decide(decision: string) {
    resolve
      .mutateAsync({ id, decision })
      .then(() => toast.success(decision === "deny" ? "Denied" : "Approved"))
      .catch(toastError);
  }

  // Approve AND remember. The kernel mints the standing grant itself — scoped to
  // this agent, to the call's path when it has one, expiring on its own — and
  // refuses to mint one it cannot scope safely. So this sends the intent and
  // reports back whatever it decided (`remember_note`) instead of composing a
  // grant here and claiming a scope the panel does not control. `decision` is
  // the escalation's own spelling of approve, never the literal.
  function alwaysAllow(decision: string) {
    resolve
      .mutateAsync({ id, decision, remember: true })
      .then((r) => toast.success("Approved", { description: r?.remember_note }))
      .catch(toastError);
  }

  return (
    <div className="rounded-md border border-warning/50 bg-warning/10 p-2.5 text-xs">
      <p className="flex items-center gap-1.5 font-medium">
        <ShieldAlert className="size-3.5 text-warning" />
        Needs your approval{toolName ? ` · ${toolName}` : ""}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{e.decision_point}</p>
      {e.context_summary && (
        <p className="mt-1 text-muted-foreground">{e.context_summary}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {escOptions(e).map((opt) => (
          <Button
            key={opt}
            size="sm"
            variant={opt === "deny" ? "outline" : "default"}
            disabled={busy}
            onClick={() => decide(opt)}
            aria-label={`${opt.charAt(0).toUpperCase() + opt.slice(1)}${toolName ? ` ${toolName}` : ""}`}
          >
            {opt.charAt(0).toUpperCase() + opt.slice(1)}
          </Button>
        ))}
        {/* Only on the kernel's own tool approvals: on anything else (an
            agent-authored escalation, a device gate) `remember` is a no-op, so
            the button would promise something that never happens. No `toolName`
            needed — the kernel reads the tool off the escalation itself, so this
            works even when several calls are in flight. */}
        {canGrant && canRemember(e) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => alwaysAllow(matchOption(e, "approve")!)}
          >
            Always allow{toolName ? ` ${toolName}` : ""}
          </Button>
        )}
      </div>
    </div>
  );
}

export function QuestionCard({
  n,
  autoFocus = false,
}: {
  n: NotificationSummary;
  autoFocus?: boolean;
}) {
  const respond = useRespondNotification();
  const [text, setText] = useState("");
  // ponytail: free text only — surface `options` chips once NotificationSummary
  // carries the Question kind's options.
  function send() {
    const t = text.trim();
    if (!t) return;
    respond
      .mutateAsync({ id: n.id, text: t })
      .then(() => setText(""))
      .catch(toastError);
  }
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 text-xs">
      <p className="flex items-center gap-1.5 font-medium">
        <MessageCircleQuestion className="size-3.5 text-primary" />
        The agent is asking you
      </p>
      <p className="mt-1 whitespace-pre-wrap">{n.body || n.subject}</p>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your answer…"
          className="h-8"
          autoFocus={autoFocus}
        />
        <Button type="submit" size="sm" disabled={respond.isPending || !text.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}

export function HumanInLoop({ stream }: { stream: ChatStream }) {
  const can = useAuthStore((s) => s.can);
  const active = streamTools(stream).some((t) => t.success === undefined && t.taskId);
  const interval = active ? POLL_MS : (false as const);
  // Gated on the read scopes like the activity page: a chat-only key would
  // otherwise sit in a 1.5s 403 loop the moment an agent calls a tool. The
  // pending-only entry is shared with the sidebar badge, which simply refreshes
  // faster while a tool call is waiting on the operator.
  const escalations = useEscalations({
    enabled: active && can("escalations:r"),
    refetchInterval: interval,
    pending: true,
  });
  const notifications = useNotifications({
    enabled: active && can("notifications:r"),
    refetchInterval: interval,
  });
  if (!active) return null;
  const { approvals, questions } = pendingHumanInput(
    stream,
    escalations.data ?? [],
    notifications.data ?? [],
  );
  if (approvals.length === 0 && questions.length === 0) return null;
  return (
    <div className="space-y-2 pt-1">
      {approvals.map((a) => (
        <ApprovalCard key={a.escalation.id} escalation={a.escalation} toolName={a.toolName} />
      ))}
      {questions.map((q) => (
        // The chat card mounts in response to the operator's own turn, so taking
        // focus is right here — the bell panel mounts on every open, where it
        // would be a focus steal, and passes nothing.
        <QuestionCard key={q.id} n={q} autoFocus />
      ))}
    </div>
  );
}
