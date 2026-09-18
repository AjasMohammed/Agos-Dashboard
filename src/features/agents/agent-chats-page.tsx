import { useEffect, useLayoutEffect, useState, type CSSProperties, type FormEvent } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  MessagesSquare,
  PanelLeft,
  PanelLeftClose,
  Loader2,
  Play,
  Plus,
  Send,
  Square,
} from "lucide-react";
import {
  activelyRunning,
  convoKeys,
  useAgentChats,
  useAgentChat,
  useContinueAgentChat,
  useCreateAgentChat,
  usePostAgentChatMessage,
  useStopAgentChat,
} from "@/api/queries/agent-chats";
import { useAgents } from "@/api/queries/agents";
import type { ConvoSummary } from "@/api/models";
import { nextSpeaker, titleOf, USER_SPEAKER } from "./convo-seed";
import { useStickToBottom } from "@/features/chat/stick-to-bottom";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { TypingDots } from "@/components/typing-dots";
import { useChannel } from "@/realtime/useChannel";
import { StatusBadge } from "@/components/status-badge";
import { EASE_OUT } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage, toastError } from "@/lib/errors";
import { relativeTime, stripUserDataTags } from "@/lib/format";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { cn } from "@/lib/utils";

/**
 * Stable per-agent hue so every speaker in a conversation is visually distinct.
 * Emitted as CSS vars: the avatar tint stays translucent (so `foreground` body
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
    "--agent-fg": `hsl(${hue} 65% 32%)`,
    "--agent-fg-dark": `hsl(${hue} 75% 72%)`,
  } as CSSProperties;
}

const AGENT_NAME_CLASS = "text-[color:var(--agent-fg)] dark:text-[color:var(--agent-fg-dark)]";

/** Same content column as chat — full pane width; the rail is the only thing that eats it. */
const COLUMN = "w-full px-4 sm:px-6";

const TURN_LIMITS = { min: 2, max: 50 } as const;

function NewConvoDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (convo: ConvoSummary) => void;
}) {
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
      const convo = await create.mutateAsync({
        topic: topic.trim(),
        participants: [...selected],
        max_turns: turns,
      });
      toast.success("Conversation started");
      reset();
      onOpenChange(false);
      onCreated(convo);
    } catch (err) {
      toastError(err);
    }
  }

  const canSubmit = topic.trim().length > 0 && selected.size >= 2 && turnsValid;

  // A picked participant that has since left the roster still counts toward
  // what gets SENT, so it has to be on screen — otherwise Start is enabled with
  // nothing visibly picked, and the operator can't drop the missing agent.
  const roster = agents.data ?? [];
  const names = [
    ...roster.map((a) => a.name),
    ...[...selected].filter((n) => !roster.some((a) => a.name === n)),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Start an agent conversation</DialogTitle>
            <DialogDescription>
              Pick 2+ agents and a topic; they talk for up to the turn limit. You can join in at any
              point.
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
                ) : names.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No agents connected.</p>
                ) : (
                  names.map((name) => (
                    <Button
                      key={name}
                      type="button"
                      size="sm"
                      variant={selected.has(name) ? "default" : "outline"}
                      onClick={() => toggle(name)}
                      title={
                        roster.some((a) => a.name === name) ? undefined : "No longer connected"
                      }
                    >
                      {name}
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

/** The turn being produced right now, from the `agent-chat:<id>` realtime channel. */
interface LiveTurn {
  agent: string;
  turn: number;
  text: string;
  tool: string | null;
  /** `turn.end` seen; kept on screen until its stored row lands. */
  done: boolean;
}

/** A speaker's turn: same shape as chat's assistant turn, avatar tinted per agent. */
function Turn({
  agent,
  avatar,
  children,
  meta,
}: {
  agent: string;
  avatar?: string | null;
  children: React.ReactNode;
  meta: string;
}) {
  const name = agent === USER_SPEAKER ? "You" : agent;
  return (
    <div style={agentStyle(agent)} className="flex gap-3">
      {avatar ? (
        <img
          src={avatar}
          alt=""
          aria-hidden
          className="mt-0.5 size-7 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-[color:var(--agent-bg)] text-xs font-semibold uppercase"
        >
          <span className={AGENT_NAME_CLASS}>{name.slice(0, 2)}</span>
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1 pt-0.5">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-sm font-medium", AGENT_NAME_CLASS)}>{name}</span>
          <span className="text-xs text-muted-foreground">{meta}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The transcript pane — the same anatomy as a chat session (header, sticky
 * scroll region, pinned footer bar), so an agent conversation reads like one.
 */
function Conversation({
  convo,
  railOpen,
  onToggleRail,
}: {
  convo: ConvoSummary;
  railOpen: boolean;
  onToggleRail: () => void;
}) {
  const detail = useAgentChat(convo.id);
  // Cached agent list (same key as everywhere else) — only read for speaker avatars.
  const agents = useAgents();
  const stop = useStopAgentChat();
  const resume = useContinueAgentChat();
  const post = usePostAgentChatMessage();
  const [draft, setDraft] = useState("");
  const qc = useQueryClient();
  const [lives, setLives] = useState<LiveTurn[]>([]);
  // Set by `convo.done` until the next turn starts: the runner emits it just
  // before writing the final status, so a refetch can still read `running`.
  const [ended, setEnded] = useState(false);
  const { viewportRef, contentRef, onScroll, showJump, scrollToBottom } = useStickToBottom();
  const d = detail.data;
  const status = d?.status ?? convo.status;
  const running = status === "running";
  // `max_turns` budgets agent turns; the operator's own messages don't count.
  const turns = d?.messages.filter((m) => m.agent_name !== USER_SPEAKER).length ?? 0;

  // Frames can be shed or missed across a reconnect, and the next `turn.start`
  // usually beats the `turn.end` refetch — so only the stored row landing retires
  // a live turn. Stored numbers are never lower than the streamed one (operator
  // rows can only push them up), and every earlier row by that agent is lower.
  const isStored = (l: LiveTurn) =>
    d?.messages.some((m) => m.agent_name === l.agent && m.turn_number >= l.turn) ?? false;

  useChannel(`agent-chat:${convo.id}`, (ev) => {
    const data = ev.data as {
      agent: string;
      turn: number;
      text?: string;
      tool_name?: string | null;
    };
    const same = (l: LiveTurn) => l.agent === data.agent && l.turn === data.turn;
    const upsert = (f: (l: LiveTurn) => LiveTurn) =>
      setLives((ls) =>
        ls.some(same)
          ? ls.map((l) => (same(l) ? f(l) : l))
          : [
              ...ls.filter((l) => !isStored(l)),
              f({ agent: data.agent, turn: data.turn, text: "", tool: null, done: false }),
            ],
      );
    if (ev.event !== "convo.done") setEnded(false);
    switch (ev.event) {
      case "turn.start":
        upsert((l) => ({ ...l, text: "", tool: null, done: false }));
        break;
      case "turn.text":
        upsert((l) => ({ ...l, text: l.text + (data.text ?? ""), tool: null }));
        break;
      case "turn.tool":
        // Text before a tool call isn't part of the stored answer (only the last
        // pass is), so drop it rather than swap the bubble at turn end.
        upsert((l) => ({ ...l, text: "", tool: data.tool_name ?? null }));
        break;
      case "turn.end":
        setLives((ls) => ls.map((l) => (same(l) ? { ...l, done: true } : l)));
        void qc.invalidateQueries({ queryKey: convoKeys.detail(convo.id) });
        break;
      case "convo.done":
        setEnded(true);
        setLives((ls) => ls.map((l) => ({ ...l, done: true })));
        void qc.invalidateQueries({ queryKey: convoKeys.all });
        break;
    }
  });

  // A finished turn with no text (silent, or cut after a tool) has nothing to show.
  const shown = lives.filter((l) => !isStored(l) && (!l.done || l.text));
  const active = [...shown].reverse().find((l) => !l.done);

  // `ended` only guards the refetch that still reads `running` right after
  // `convo.done`; once not running it has done its job, and a later run seen
  // only by polling needs its dots.
  useEffect(() => {
    if (!running && ended) setEnded(false);
  }, [running, ended]);

  // The detail query stops polling once stopped or stale, so a live turn whose
  // `turn.end` was lost would stay up forever — fetch until its row lands.
  const orphaned = shown.length > 0 && !activelyRunning(status, d?.updated_at ?? convo.updated_at);
  useEffect(() => {
    if (!orphaned) return;
    const t = setInterval(
      () => void qc.invalidateQueries({ queryKey: convoKeys.detail(convo.id) }),
      3000,
    );
    return () => clearInterval(t);
  }, [orphaned, qc, convo.id]);

  // A live frame wins even after Stop — the runner still finishes that turn. The
  // rotation guess only fills in while no frame has been seen for this stretch.
  const speaker =
    active?.agent ??
    (running && !ended && d && shown.length === 0
      ? nextSpeaker(convo.participants, d.messages)
      : undefined);

  function send() {
    const content = draft.trim();
    if (!content || post.isPending) return;
    post
      .mutateAsync({ id: convo.id, content })
      .then(() => {
        setEnded(false);
        setDraft("");
        scrollToBottom();
      })
      .catch(toastError);
  }

  // Open a conversation at its newest turn, with no scroll animation. Following
  // new turns from there is the ResizeObserver's job (see `useStickToBottom`).
  useLayoutEffect(() => {
    scrollToBottom("auto");
  }, [convo.id, scrollToBottom]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
        <Button
          variant="ghost"
          size="icon"
          title={railOpen ? "Hide conversations" : "Show conversations"}
          onClick={onToggleRail}
        >
          {railOpen ? <PanelLeftClose /> : <PanelLeft />}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{titleOf(convo.topic)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {convo.participants.join(" · ")}
            {d?.max_turns
              ? ` · turn ${turns} of ${d.max_turns}`
              : turns
                ? ` · ${turns} turn${turns === 1 ? "" : "s"}`
                : ""}
            {d?.created_at && ` · started ${relativeTime(d.created_at)}`}
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      {/* role="log" + polite: without it a screen-reader user gets no signal
          that a turn landed — the transcript just changes silently. */}
      <div
        ref={viewportRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div ref={contentRef} className={cn(COLUMN, "flex flex-col gap-6 py-6")}>
          {detail.isError ? (
            <p className="py-6 text-center text-sm text-destructive">
              {errorMessage(detail.error)}
            </p>
          ) : !d ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : d.messages.length === 0 && !speaker ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No turns yet.</p>
          ) : (
            <>
              {d.messages.map((t) => (
                <Turn
                  key={t.turn_number}
                  agent={t.agent_name}
                  avatar={agents.data?.find((a) => a.name === t.agent_name)?.avatar}
                  meta={`#${t.turn_number} · ${relativeTime(t.created_at)}`}
                >
                  <Markdown className="text-[15px]">{stripUserDataTags(t.content)}</Markdown>
                </Turn>
              ))}
              {/* Off: a polite log would read every streamed delta aloud; the
                  dots' own role="status" still announces who is typing. */}
              <div aria-live="off" className="flex flex-col gap-6 empty:hidden">
                {shown.map((l) => (
                  <Turn
                    key={`${l.agent}:${l.turn}`}
                    agent={l.agent}
                    avatar={agents.data?.find((a) => a.name === l.agent)?.avatar}
                    meta={
                      l.done
                        ? "just now"
                        : l.tool
                          ? `using ${l.tool}…`
                          : l.text
                            ? "replying…"
                            : "typing…"
                    }
                  >
                    {l.text ? (
                      <Markdown className={cn("text-[15px]", !l.done && "streaming")}>
                        {stripUserDataTags(l.text)}
                      </Markdown>
                    ) : (
                      <TypingDots
                        label={l.tool ? `Using ${l.tool}…` : "Thinking…"}
                        srLabel={`${l.agent} is typing`}
                      />
                    )}
                  </Turn>
                ))}
                {speaker && !active && (
                  <Turn
                    agent={speaker}
                    avatar={agents.data?.find((a) => a.name === speaker)?.avatar}
                    meta="typing…"
                  >
                    <TypingDots srLabel={`${speaker} is typing`} />
                  </Turn>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="relative shrink-0">
        {/* Content scrolls out under the footer instead of stopping at a hard edge. */}
        <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
        <AnimatePresence>
          {showJump && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.9 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              onClick={() => scrollToBottom()}
              className="absolute -top-11 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-popover hover:bg-accent"
            >
              <ArrowDown className="size-3.5" /> Jump to latest
            </motion.button>
          )}
        </AnimatePresence>
        <div className={cn(COLUMN, "space-y-2 py-3")}>
          <div className="flex items-center justify-center gap-3">
            <p className="text-xs text-muted-foreground">
              {speaker
                ? `${speaker} is replying…`
                : running
                  ? "Agents are talking — turns appear as they arrive."
                  : `This conversation ended after ${turns} turn${turns === 1 ? "" : "s"}.`}
            </p>
            {running ? (
              <Button
                variant="outline"
                size="sm"
                disabled={stop.isPending}
                onClick={() =>
                  stop
                    .mutateAsync(convo.id)
                    .then(() => toast.success("Stopping after the current turn"))
                    .catch(toastError)
                }
              >
                <Square className="fill-current" />
                {stop.isPending ? "Stopping…" : "Stop"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={resume.isPending}
                onClick={() =>
                  resume
                    .mutateAsync(convo.id)
                    .then(() => setEnded(false))
                    .catch(toastError)
                }
              >
                <Play />
                {resume.isPending ? "Continuing…" : "Continue"}
              </Button>
            )}
          </div>
          {/* The operator's seat at the table: a running conversation answers on
              its next turn, a finished one resumes for a round. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2 rounded-lg border border-border bg-card p-1.5 pl-3 transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25"
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                running
                  ? "Join in — agents see this on the next turn"
                  : "Say something to restart the conversation"
              }
              aria-label="Message the agents"
              maxLength={4000}
              rows={1}
              className="max-h-52 min-h-[24px] flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-0 py-1.5 text-[15px] shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                // Enter that confirms an IME composition is not a send.
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              className="shrink-0"
              disabled={!draft.trim() || post.isPending}
              title="Send"
              aria-label="Send"
            >
              {post.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AgentChatsPage() {
  const query = useAgentChats();
  const reduced = useReducedMotion();
  const narrow = useIsNarrow();
  const [selected, setSelected] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  // A conversation we just created, kept until the list query catches up — without
  // it `selected` names an id the list doesn't have yet and the pane falls back.
  const [created, setCreated] = useState<ConvoSummary | null>(null);

  const fetched = query.data?.items ?? [];
  const items =
    created && !fetched.some((c) => c.id === created.id) ? [created, ...fetched] : fetched;
  const current = selected ? (items.find((c) => c.id === selected) ?? null) : (items[0] ?? null);

  // The only rail toggle lives in a conversation header — with no pane rendered,
  // a collapsed rail would hide "New conversation" with no way back. Not on
  // narrow though: there the rail floats over the page behind a scrim, and
  // forcing it open with no conversation to select left that scrim up for good
  // (Escape and backdrop-click clear `railOpen`, which this branch overrides)
  // with the empty state's own CTA sealed underneath it.
  const showRail = railOpen || (!current && !narrow);
  // Below `md` the 264px rail would leave the pane ~120px wide, so it FLOATS
  // over it there instead of eating its width.
  const overlay = narrow && showRail;

  // Not persisted: this is the viewport talking, not the operator.
  useEffect(() => {
    if (narrow) setRailOpen(false);
  }, [narrow]);

  // Escape closes it, like any other overlay.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  function openConvo(id: string) {
    setSelected(id);
    if (narrow) setRailOpen(false);
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* The shell's PageHeader is gone here — the transcript owns the viewport —
          so the route still needs a name for screen readers. */}
      <h1 className="sr-only">Agent chats</h1>
      {overlay && (
        <div
          aria-hidden
          onClick={() => setRailOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 animate-fade-in"
        />
      )}
      <motion.aside
        animate={{ width: showRail ? 264 : 0 }}
        initial={false}
        transition={reduced ? { duration: 0 } : { duration: 0.25, ease: EASE_OUT }}
        className={cn(
          "flex shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar",
          overlay && "fixed inset-y-0 left-0 z-40 shadow-dialog",
        )}
      >
        <div className="w-[264px] border-b border-border p-3">
          <Button className="w-full justify-start" onClick={() => setDialogOpen(true)}>
            <Plus /> New conversation
          </Button>
        </div>
        <div className="w-[264px] flex-1 overflow-y-auto p-2">
          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : query.isError ? (
            <p className="p-3 text-sm text-destructive">{errorMessage(query.error)}</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No conversations yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => openConvo(c.id)}
                    aria-current={current?.id === c.id ? "true" : undefined}
                    className={cn(
                      "w-full cursor-pointer rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      current?.id === c.id ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <span className="block truncate font-medium text-foreground">
                      {titleOf(c.topic)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.participants.join(" · ")}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusBadge status={c.status} />
                      {relativeTime(c.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.aside>

      {current ? (
        <Conversation
          key={current.id}
          convo={current}
          railOpen={showRail}
          onToggleRail={() => setRailOpen((o) => !o)}
        />
      ) : (
        // Only an *answered* list can say there is nothing here — `current` is
        // also null while the first fetch is in flight and after it fails, and
        // the rail already reports both of those.
        query.isSuccess && (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessagesSquare}
              title="No agent conversations"
              description="Pick 2+ agents and a topic; they talk autonomously among themselves."
              action={<Button onClick={() => setDialogOpen(true)}>New conversation</Button>}
            />
          </div>
        )
      )}

      <NewConvoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(c) => {
          setCreated(c);
          openConvo(c.id);
        }}
      />
    </div>
  );
}
