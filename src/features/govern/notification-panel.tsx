import { useState } from "react";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  useDismissNotification,
  useMarkAllNotificationsRead,
  useNotifications,
  useUnreadCount,
} from "@/api/queries/notifications";
import { useEscalations } from "@/api/queries/governance";
import { ApprovalCard, QuestionCard } from "@/features/chat/human-in-loop";
import { senderAgentId } from "@/features/activity/activity-feed";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/auth/store";
import { agentLabel, useAgentNames } from "@/lib/agent-names";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { panelRows } from "./notification-rows";
import type { NotificationSummary } from "@/api/models";

/**
 * The bell's popover: what arrived, and the two things an operator can act on
 * without leaving the page — a pending approval and an agent's question.
 *
 * The cards are the same components the in-chat human-in-loop prompts use. That
 * is deliberate: an approval rendered two different ways is an approval that
 * drifts, and `ApprovalCard` already carries the parts that are easy to get
 * wrong (the escalation's own spelling of its options, the `approvals:w` check
 * behind "Always allow", the kernel-authored `remember_note`).
 *
 * Mounted only while open, so neither query runs against a closed panel.
 */
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  // Subscribe to the derived boolean, not the stable `can` ref — selecting the
  // function means no re-render when /auth/me lands.
  const canReadEscalations = useAuthStore((s) => s.can("escalations:r"));
  const canResolve = useAuthStore((s) => s.can("escalations:w"));
  const canWrite = useAuthStore((s) => s.can("notifications:w"));
  const notifications = useNotifications();
  // The kernel auto-denies after 5 min; the shared 5s refetch keeps an open
  // panel from offering Approve on a row that is already gone.
  const escalations = useEscalations({ enabled: canReadEscalations, pending: true });
  const markAllRead = useMarkAllNotificationsRead();
  const dismiss = useDismissNotification();
  // Server-side COUNT(*) over the whole table. The list below is only the
  // newest 50 rows, so counting unread in it would both under-report the badge
  // and disable "Mark all read" while older unread messages exist.
  const unread = useUnreadCount().data?.unread_count ?? 0;
  const agentName = useAgentNames();
  // Per-row in-flight set — a shared `dismiss.isPending` disables Dismiss on
  // every row, not the one that was clicked.
  const [dismissing, setDismissing] = useState<ReadonlySet<string>>(new Set());

  // Without `escalations:w` the Approve/Deny buttons only 403, so the cards are
  // not rendered — and their notifications must stay in the list below, which is
  // then the only trace of the prompt.
  const pending = canResolve ? (escalations.data ?? []).filter((e) => !e.resolved) : [];
  const items = notifications.data ?? [];
  const rows = panelRows(items, new Set(pending.map((e) => Number(e.id))));
  // An empty list and a failed fetch look identical in the data; on a surface
  // whose job is "an approval is blocking a task", saying "nothing new" when the
  // request actually failed is the wrong failure mode.
  const failed = notifications.isError || (canReadEscalations && escalations.isError);

  function onDismiss(n: NotificationSummary) {
    setDismissing((prev) => new Set(prev).add(n.id));
    dismiss
      .mutateAsync(n.id)
      .then(() => toast.success("Dismissed"))
      .catch(toastError)
      .finally(() =>
        setDismissing((prev) => {
          const next = new Set(prev);
          next.delete(n.id);
          return next;
        }),
      );
  }

  function sender(from: string | null | undefined) {
    const id = senderAgentId(from);
    return id ? agentLabel(agentName(id), id) : from || "";
  }

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      // `100vw-6rem`, not `-2rem`: the bell is not at the viewport edge — the
      // theme toggle and user menu sit to its right — so a popover anchored to
      // the bell's right edge is clipped off-screen on a phone by that offset.
      className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(32rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-6rem))] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-popover"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">Notifications</span>
        <span className="text-xs text-muted-foreground">{unread} unread</span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {pending.map((e) => (
          <ApprovalCard key={`esc-${e.id}`} escalation={e} />
        ))}

        {rows.map((n) =>
          n.needs_response ? (
            <QuestionCard key={n.id} n={n} />
          ) : (
            <div
              key={n.id}
              className={cn("rounded-md border border-border p-2.5 text-xs", n.read && "opacity-70")}
            >
              <p className="font-medium">{n.subject}</p>
              {n.body && <p className="mt-1 line-clamp-3 text-muted-foreground">{n.body}</p>}
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground">
                  {n.from ? `${sender(n.from)} · ` : ""}
                  {relativeTime(n.timestamp)}
                </span>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    disabled={dismissing.has(n.id)}
                    onClick={() => onDismiss(n)}
                  >
                    Dismiss
                  </Button>
                )}
              </div>
            </div>
          ),
        )}

        {failed && (
          <p className="p-4 text-xs text-destructive">
            Couldn&rsquo;t load notifications. Open the inbox to retry.
          </p>
        )}
        {!failed && pending.length === 0 && rows.length === 0 && (
          <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
            <Info className="size-4" />
            Nothing new.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-2">
        {canWrite ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() =>
              markAllRead
                .mutateAsync()
                .then(() => toast.success("All marked read"))
                .catch(toastError)
            }
          >
            Mark all read
          </Button>
        ) : (
          <span />
        )}
        {/* Section routes are registered dynamically from NAV, so the router's
            static type union doesn't know them — same string-widening as nav links. */}
        <Link to={"/notifications" as string} onClick={onClose} className="px-2 text-xs underline">
          View all
        </Link>
      </div>
    </div>
  );
}
