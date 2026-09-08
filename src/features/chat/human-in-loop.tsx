import { useState } from "react";
import { MessageCircleQuestion, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  useAddApprovalPolicy,
  useEscalations,
  useResolveEscalation,
} from "@/api/queries/governance";
import { useNotifications, useRespondNotification } from "@/api/queries/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastError } from "@/lib/errors";
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

/** How long an "Always allow" granted from a chat card stays in force. */
const GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const escOptions = (e: Escalation) => (e.options?.length ? e.options : ["approve", "deny"]);

function ApprovalCard({ escalation: e, toolName }: { escalation: Escalation; toolName?: string }) {
  const resolve = useResolveEscalation();
  const grant = useAddApprovalPolicy();
  const busy = resolve.isPending || grant.isPending;
  const id = String(e.id);

  function decide(decision: string) {
    resolve
      .mutateAsync({ id, decision })
      .then(() => toast.success(decision === "deny" ? "Denied" : "Approved"))
      .catch(toastError);
  }

  function alwaysAllow() {
    if (!toolName) return;
    // Scope the standing grant to the agent that asked and give it an expiry —
    // an omitted `agent_id` means EVERY agent and an omitted `expires_at` means
    // forever, which is far more than one click in one chat should buy.
    grant
      .mutateAsync({
        tool_name: toolName,
        agent_id: e.agent_id,
        expires_at: new Date(Date.now() + GRANT_TTL_MS).toISOString(),
      })
      .then(() => resolve.mutateAsync({ id, decision: "approve" }))
      .then(() => toast.success(`Allowing ${toolName} for 30 days`))
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
        {/* Only when exactly one call is in flight for this turn — otherwise we
            cannot say which tool the escalation is for. */}
        {toolName && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={alwaysAllow}>
            Always allow {toolName}
          </Button>
        )}
      </div>
    </div>
  );
}

function QuestionCard({ n }: { n: NotificationSummary }) {
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
          autoFocus
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
        <QuestionCard key={q.id} n={q} />
      ))}
    </div>
  );
}
