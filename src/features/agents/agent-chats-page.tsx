import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { toast } from "sonner";
import { MessagesSquare } from "lucide-react";
import {
  useAgentChats,
  useAgentChat,
  useCreateAgentChat,
  useStopAgentChat,
} from "@/api/queries/agent-chats";
import { useAgents } from "@/api/queries/agents";
import type { ConvoDetail, ConvoSummary } from "@/api/models";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { errorMessage, toastError } from "@/lib/errors";
import { relativeTime, stripUserDataTags } from "@/lib/format";

/**
 * Stable per-agent hue so every speaker in a conversation is visually distinct.
 * Emitted as CSS vars: the bubble tint stays translucent (so `foreground` body
 * text keeps its contrast in both themes) and only the name takes the full hue,
 * with a lighter variant swapped in under `.dark`.
 */
function agentStyle(name: string): CSSProperties {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  // ponytail: golden-angle spread — good separation up to ~20 agents, swap for a
  // fixed palette keyed on participant index if collisions ever matter.
  const hue = (h * 137) % 360;
  return {
    "--agent-bg": `hsl(${hue} 70% 50% / 0.12)`,
    "--agent-border": `hsl(${hue} 70% 45% / 0.5)`,
    "--agent-fg": `hsl(${hue} 65% 32%)`,
    "--agent-fg-dark": `hsl(${hue} 75% 72%)`,
  } as CSSProperties;
}

const AGENT_NAME_CLASS = "text-[color:var(--agent-fg)] dark:text-[color:var(--agent-fg-dark)]";

const TURN_LIMITS = { min: 2, max: 50 } as const;

function NewConvoDialog() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [maxTurns, setMaxTurns] = useState("8");
  const agents = useAgents();
  const create = useCreateAgentChat();

  function reset() {
    setTopic("");
    setSelected(new Set());
    setMaxTurns("8");
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const turns = Number(maxTurns);
  const turnsValid =
    Number.isInteger(turns) && turns >= TURN_LIMITS.min && turns <= TURN_LIMITS.max;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({
        topic: topic.trim(),
        participants: [...selected],
        max_turns: turns,
      });
      toast.success("Conversation started");
      reset();
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }

  const canSubmit = topic.trim().length > 0 && selected.size >= 2 && turnsValid;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">New conversation</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Start an agent conversation</DialogTitle>
            <DialogDescription>
              Pick 2+ agents and a topic; they talk autonomously for up to the turn limit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            {/* Wrapping label rather than htmlFor: these Inputs have no id, so a
                sibling <label> announced "edit text, blank" and clicking it
                focused nothing. Same shape as the builder's `Field`. */}
            <label className="block space-y-1">
              <span className="block text-sm font-medium">Topic</span>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Plan next week's data pipeline maintenance"
                autoFocus
              />
            </label>
            <div className="space-y-1">
              {/* A toggle-button group, not a form control — labelled by id
                  rather than wrapped, so it is announced as a named group. */}
              <p id="convo-participants-label" className="text-sm font-medium">
                Participants (2+)
              </p>
              <div
                role="group"
                aria-labelledby="convo-participants-label"
                className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto"
              >
                {/* `data?.length === 0` is false while data is undefined, so the
                    load and the failure both used to render as a blank area with
                    Start disabled (2+ needed) and nothing explaining why. */}
                {agents.isLoading ? (
                  <>
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-28" />
                  </>
                ) : agents.isError ? (
                  <p className="text-xs text-destructive">
                    Couldn’t load agents: {errorMessage(agents.error)}
                  </p>
                ) : agents.data?.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No agents connected.</p>
                ) : (
                  (agents.data ?? []).map((a) => (
                    <Button
                      key={a.name}
                      type="button"
                      size="sm"
                      variant={selected.has(a.name) ? "default" : "outline"}
                      onClick={() => toggle(a.name)}
                    >
                      {a.name}
                    </Button>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-1">
              <label className="block space-y-1">
                <span className="block text-sm font-medium">
                  Max turns ({TURN_LIMITS.min}–{TURN_LIMITS.max})
                </span>
                <Input
                  type="number"
                  min={TURN_LIMITS.min}
                  max={TURN_LIMITS.max}
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(e.target.value)}
                />
              </label>
              {!turnsValid && (
                <p className="text-xs text-destructive">
                  Enter a whole number between {TURN_LIMITS.min} and {TURN_LIMITS.max}.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !canSubmit}>
              {create.isPending ? "Starting…" : "Start"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The header is rendered from the list row (not from the detail query) so the
 * dialog always has a `DialogTitle`/`DialogDescription` — Radix errors out on
 * an untitled `DialogContent`, which the loading frame used to be.
 */
function ConvoDetailDialog({
  convo,
  open,
  onOpenChange,
}: {
  convo: ConvoSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Gate on `open`, not only on the id: `selected` is deliberately kept after
  // close, and the hook's `enabled` keys off the id — so the query used to stay
  // active for the life of the page and refetch on every list invalidation.
  const detail = useAgentChat(open ? (convo?.id ?? null) : null, open);
  const stop = useStopAgentChat();
  const scroller = useRef<HTMLDivElement>(null);
  const seenTurns = useRef(0);
  // Disabling the query drops its data, which would blank the turns mid
  // close-animation — the exact flash `selected` outliving the close prevents.
  // Only used while closed, so a half-loaded conversation never shows another's.
  const lastLoaded = useRef<ConvoDetail | null>(null);
  if (detail.data) lastLoaded.current = detail.data;
  const d = detail.data ?? (open ? null : lastLoaded.current);
  const status = d?.status ?? convo?.status;
  const running = status === "running";
  const turns = d?.messages.length ?? 0;

  // Switching conversations is not turn growth — and it is not the same
  // document either: drop the retained copy too, or opening A, closing it, then
  // opening B and closing before B resolves renders A's turns under B's topic.
  useEffect(() => {
    seenTurns.current = 0;
    lastLoaded.current = null;
  }, [convo?.id]);

  // Follow a conversation as turns land — including the last one, which arrives
  // in the same response that flips the status to `complete`. Settled
  // conversations open at the top, and a reader who scrolled up is left alone.
  useEffect(() => {
    const el = scroller.current;
    const grew = turns > seenTurns.current && seenTurns.current > 0;
    seenTurns.current = turns;
    if (!el || !grew) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [turns]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="min-w-0 truncate">{convo?.topic}</span>
            {status && <StatusBadge status={status} />}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {(convo?.participants ?? []).map((p) => (
                  <span
                    key={p}
                    style={agentStyle(p)}
                    className={`rounded-full bg-[color:var(--agent-bg)] px-2 py-0.5 text-xs font-medium ${AGENT_NAME_CLASS}`}
                  >
                    {p}
                  </span>
                ))}
              </div>
              {d && (
                <p className="text-xs">
                  {d.max_turns ? `turn ${turns} of ${d.max_turns}` : `${turns} turns`}
                  {d.created_at && ` · started ${relativeTime(d.created_at)}`}
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <div ref={scroller} className="max-h-[50vh] space-y-3 overflow-y-auto py-2">
          {detail.isError ? (
            <p className="py-6 text-center text-sm text-destructive">
              {errorMessage(detail.error)}
            </p>
          ) : !d ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : d.messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No turns yet{running ? " — agents are thinking…" : "."}
            </p>
          ) : (
            d.messages.map((t) => (
              <div
                key={t.turn_number}
                style={agentStyle(t.agent_name)}
                className="rounded-lg border-l-2 border-[color:var(--agent-border)] bg-[color:var(--agent-bg)] px-3 py-2 text-sm text-foreground"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={`font-medium ${AGENT_NAME_CLASS}`}>{t.agent_name}</span>
                  <span className="text-xs text-muted-foreground">
                    #{t.turn_number} · {relativeTime(t.created_at)}
                  </span>
                </div>
                <Markdown>{stripUserDataTags(t.content)}</Markdown>
              </div>
            ))
          )}
        </div>
        {running && (
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={stop.isPending || !convo}
              onClick={() =>
                stop
                  .mutateAsync(convo!.id)
                  .then(() => toast.success("Stopped"))
                  .catch(toastError)
              }
            >
              {stop.isPending ? "Stopping…" : "Stop conversation"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AgentChatsPage() {
  const query = useAgentChats();
  // `open` is separate from `selected` so the dialog keeps its content (title,
  // participants, turns) through the close animation instead of gutting itself.
  const [selected, setSelected] = useState<ConvoSummary | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title="Agent chats"
        description="Autonomous multi-agent conversations — agents discussing a topic among themselves."
        actions={<NewConvoDialog />}
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState icon={MessagesSquare} title="No agent conversations" />}
      >
        {(data) => (
          <div className="space-y-2">
            {data.items.map((c) => (
              <button
                key={c.id}
                className="block w-full text-left"
                onClick={() => {
                  setSelected(c);
                  setOpen(true);
                }}
              >
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.topic}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.participants.join(" · ")} · updated {relativeTime(c.updated_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">{c.participants.length} agents</Badge>
                      <StatusBadge status={c.status} />
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
      </QueryState>
      <ConvoDetailDialog convo={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
