import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  Download,
  FileText,
  GitFork,
  Globe,
  Loader2,
  MessagesSquare,
  Pencil,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Send,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  useChatSessions,
  useChatMessages,
  useCreateChatSession,
  useDeleteChatSession,
  useRenameChatSession,
  useForkChatSession,
  exportChatSession,
  chatKeys,
} from "@/api/queries/chat";
import {
  abortChatStream,
  consumeFailedChatText,
  dismissChatStream,
  startChatStream,
  stopChatStream,
  streamText,
  streamTools,
  useChatStreamStore,
  type ChatStream,
  type StreamPart,
  type ThoughtBlock,
} from "./stream-store";
import { useStickToBottom } from "./stick-to-bottom";
import { stripMarkdown } from "@/lib/preview-text";
import { useAgents } from "@/api/queries/agents";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { HumanInLoop } from "./human-in-loop";
import { Markdown } from "@/components/markdown";
import { MentionTextarea } from "@/components/mention-textarea";
import { EmptyState } from "@/components/empty-state";
import { Callout } from "@/components/ui/callout";
import { EASE_OUT } from "@/components/motion";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { copyText } from "@/lib/clipboard";
import { confirm, promptText } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { prettyJson, relativeTime } from "@/lib/format";
import { toolVerb } from "@/lib/tool-verbs";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatSessionSummary } from "@/api/models";

/** Starters for an empty chat — each maps to a tool a default chat agent has. */
const SUGGESTIONS = [
  { icon: FileText, text: "Summarize a file for me" },
  { icon: Timer, text: "Remind me every Monday at 9am" },
  { icon: Sparkles, text: "Watch my disk space and tell me if it gets low" },
  { icon: Globe, text: "Search the web for" },
];

/** Bubble entrance shared by history, streaming echo, and typing indicator. */
const bubbleMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.15 },
} as const;

/** The content column — full pane width; the rail is the only thing that eats it. */
const COLUMN = "w-full px-4 sm:px-6";


/**
 * Stable row keys for the transcript. `ChatMessage` carries no id; timestamp+role
 * is the stable pair it has, but parallel tool calls share one timestamp, so
 * repeats get an ordinal suffix. First occurrence keeps the bare key.
 */
function withRowKeys<T extends { timestamp: string; role: string }>(rows: T[]) {
  const seen = new Map<string, number>();
  return rows.map((m) => {
    const base = `${m.timestamp}:${m.role}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { m, key: n ? `${base}:${n}` : base };
  });
}

/** Newest turn of a role by timestamp — the API does not promise an order. */
function lastTurn(
  items: readonly ChatMessage[] | undefined,
  role: "user" | "assistant",
): ChatMessage | undefined {
  let last: ChatMessage | undefined;
  for (const m of items ?? []) {
    if (m.role === role && (!last || m.timestamp >= last.timestamp)) last = m;
  }
  return last;
}

const lastUserTurn = (items: readonly ChatMessage[] | undefined) => lastTurn(items, "user");

function AssistantAvatar() {
  return (
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
      <Sparkles className="size-3.5" />
    </span>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  // Kept so the tick's reset can be cancelled: the transcript unmounts rows on
  // every refetch, and a pending timer would setState on a dead component (and
  // an earlier timer would cut a second copy's tick short).
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  function copy() {
    // navigator.clipboard is absent in insecure (plain-http, non-localhost) contexts.
    if (!navigator.clipboard) {
      toast.error("Copy failed (clipboard unavailable)");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        setDone(true);
        clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setDone(false), 1400);
      },
      () => toast.error("Copy failed"),
    );
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function TypingDots() {
  return (
    // role="status" — an aria-label on a bare <span> has no role to hang off, so
    // assistive tech never announced that a reply had started.
    <span role="status" className="flex items-center gap-1.5 py-1" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: "easeInOut" }}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">Thinking…</span>
    </span>
  );
}

function duration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Status icon for a tool call. Three states, not two: `undefined` is "still
 * running" (a live call that hasn't settled), `null` is "outcome never
 * recorded" — the kernel died mid-call, or an old row predates the column.
 * Those two used to collapse into a spinner, and a persisted null was worse
 * still: it defaulted to a green tick, claiming a success nobody observed.
 */
function ToolStatusIcon({ success }: { success: boolean | null | undefined }) {
  if (success === undefined)
    return (
      <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Running" />
    );
  if (success === null)
    return <CircleDashed className="size-3.5 text-muted-foreground" aria-label="Outcome unknown" />;
  return success ? (
    <CircleCheck className="size-3.5 text-success" aria-label="Succeeded" />
  ) : (
    <CircleX className="size-3.5 text-destructive" aria-label="Failed" />
  );
}

/** One-line pill for a tool call, live or persisted. */
function ToolPill({
  name,
  success,
  time,
  onClick,
  open,
  children,
}: {
  name: string;
  success?: boolean | null;
  time?: string | null;
  onClick?: () => void;
  open?: boolean;
  children?: ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface text-xs">
      <Tag
        {...(onClick ? { type: "button" as const, onClick, "aria-expanded": open } : {})}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60"
      >
        {onClick && (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        )}
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{toolVerb(name)}</span>
        {time && <span className="shrink-0 text-muted-foreground">{time}</span>}
        <ToolStatusIcon success={success} />
      </Tag>
      <AnimatePresence initial={false}>
        {open && children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border p-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Collapsible card for a persisted role="tool" message. */
function ToolCallCard({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false);
  // Only formatted while expanded, and memoized: the parent re-renders on every
  // stream chunk, and re-parsing every card's payload each time is what made
  // opening one (or streaming next to one) hang the page.
  const payload = useMemo(
    () => (open ? prettyJson(m.tool_payload_json) : null),
    [open, m.tool_payload_json],
  );
  const result = useMemo(
    () => (open ? prettyJson(m.tool_result_json) : null),
    [open, m.tool_result_json],
  );
  return (
    <ToolPill
      name={m.tool_name ?? "tool"}
      // `?? null`, never `?? true`: an unrecorded outcome is unknown, not a win.
      success={m.tool_success ?? null}
      time={duration(m.tool_duration_ms)}
      open={open}
      onClick={() => setOpen((o) => !o)}
    >
      <p className="font-mono text-[10px] text-muted-foreground">{m.tool_name ?? "tool"}</p>
      {payload && (
        <div>
          <p className="mb-1 font-medium text-muted-foreground">What it was given</p>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-2 font-mono">
            {payload}
          </pre>
        </div>
      )}
      {result && (
        <div>
          <p className="mb-1 font-medium text-muted-foreground">What came back</p>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-2 font-mono">
            {result}
          </pre>
        </div>
      )}
      {!payload && !result && <p className="text-muted-foreground">Nothing recorded.</p>}
    </ToolPill>
  );
}

/**
 * A live tool call. Same shell as the persisted card, but fed from the stream:
 * `result_preview` is the ONLY view of what a call returned until the turn is
 * written to the transcript, so a failed call opens itself — hiding the error
 * text behind a disclosure is what made a broken turn unreadable.
 */
function LiveToolPill({ part }: { part: Extract<StreamPart, { kind: "tool" }> }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const preview = part.preview?.trim();
  const failed = part.success === false;
  const isOpen = open ?? failed;
  return (
    <ToolPill
      name={part.name}
      success={part.success}
      time={duration(part.durationMs)}
      open={isOpen}
      onClick={preview ? () => setOpen(!isOpen) : undefined}
    >
      {preview && (
        <div>
          <p className="mb-1 font-medium text-muted-foreground">
            {failed ? "What went wrong" : "What came back"}
          </p>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-2 font-mono">
            {preview}
          </pre>
        </div>
      )}
    </ToolPill>
  );
}

/**
 * An inference pass. The kernel opens each one with a bare `Thinking { iteration }`
 * marker and then streams the model's reasoning as `text` deltas — but only for
 * providers that expose any, so a pass with no text stays a labelled step and
 * nothing is ever invented to fill it.
 *
 * Reasoning renders as plain text, not Markdown: it is the model's scratchpad,
 * it is re-rendered on every delta, and a half-written fence would flash an
 * error where a thought should be.
 */
function ThinkingStep({
  iteration,
  text,
  active,
}: {
  iteration: number;
  text?: string;
  active: boolean;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  // It opens itself while the pass streams and then STAYS open until the reader
  // closes it. `active` goes false the instant the first answer token lands, so
  // following it would snap the panel shut under someone mid-sentence.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const body = text?.trim();
  const isOpen = open && Boolean(body);
  const label = (
    <>
      <BrainCircuit aria-hidden className="size-3.5 shrink-0" />
      <span className="font-medium">
        {active ? "Thinking" : "Thought"}
        {iteration > 1 && ` · pass ${iteration}`}
      </span>
      {active && <Loader2 aria-hidden className="size-3 animate-spin" />}
    </>
  );
  if (!body) return <p className="flex items-center gap-2 text-xs text-tertiary">{label}</p>;
  return (
    <div className="text-xs text-tertiary">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setOpen(!isOpen)}
        className="flex cursor-pointer items-center gap-2 rounded-md text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 shrink-0 transition-transform duration-200", isOpen && "rotate-90")}
        />
        {label}
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            {/* The transcript is a polite live region, and this panel opens
                itself — without `off` a screen reader narrates the entire
                scratchpad, token by token, BEFORE the reply it precedes. */}
            <p
              id={panelId}
              aria-live="off"
              className="ml-[7px] mt-1 whitespace-pre-wrap break-words border-l-2 border-tertiary/30 py-0.5 pl-3 text-muted-foreground"
            >
              {body}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The reasoning of the turn the transcript just took over, replayed above the
 * reply. It cannot be interleaved with the tool rows here — the persisted
 * transcript carries no ordering between them — so it sits with the tool cards
 * that already group above the answer.
 */
function HandedOverThoughts({ thoughts }: { thoughts?: ThoughtBlock[] }) {
  if (!thoughts?.length) return null;
  return (
    <div className="space-y-1">
      {thoughts.map((t, i) => (
        <ThinkingStep key={i} iteration={t.iteration} text={t.text} active={false} />
      ))}
    </div>
  );
}

/**
 * The turn's steps in the order the server emitted them: think, call, write,
 * call again, write again. They used to be regrouped as "every tool first,
 * then all the text", which is not the sequence that happened.
 */
function StreamParts({ stream, generating }: { stream: ChatStream; generating: boolean }) {
  return (
    <>
      {stream.parts.map((part, i) => {
        const last = i === stream.parts.length - 1;
        if (part.kind === "text")
          return (
            <Markdown
              // Math off while streaming: the whole string is re-parsed per
              // chunk, and a half-written formula renders as an error.
              key={i}
              math={false}
              className={cn("text-[15px]", last && generating && "streaming")}
            >
              {part.text}
            </Markdown>
          );
        if (part.kind === "thinking")
          return (
            <ThinkingStep
              key={i}
              iteration={part.iteration}
              text={part.text}
              active={last && generating}
            />
          );
        return <LiveToolPill key={i} part={part} />;
      })}
    </>
  );
}

/** What the turn cost, from the `done` frame. Absent on stopped/failed turns. */
function UsageFooter({ usage }: { usage: ChatStream["usage"] }) {
  if (!usage) return null;
  const bits: string[] = [];
  if (usage.iterations) bits.push(`${usage.iterations} pass${usage.iterations === 1 ? "" : "es"}`);
  if (usage.tokens) bits.push(`${usage.tokens.toLocaleString()} tokens`);
  // Sub-cent turns are the norm, so 4dp — 2dp would print "$0.00" for all of them.
  if (usage.costUsd) bits.push(`$${usage.costUsd.toFixed(4)}`);
  if (bits.length === 0) return null;
  return <p className="tnum text-xs text-muted-foreground">{bits.join(" · ")}</p>;
}

function toolOutcome(success: boolean | null | undefined) {
  return success === true ? "ok" : success === false ? "failed" : "unknown";
}

/**
 * The failure, attached to the turn that produced it.
 *
 * A toast alone said "something broke" and then scrolled away, with the partial
 * answer deleted along with the stream entry — leaving nothing to debug from.
 * This keeps the message, the machine-facing detail (status/code), the protocol
 * warnings collected during the turn, and a one-click transcript of all of it.
 *
 * Deliberately NO retry button: the kernel persists the user turn before
 * inference, so resending blind can post the same message twice. The composer
 * already gets the text back when the transcript proves it was not persisted
 * (see the restore effect in `Conversation`).
 */
function StreamErrorCard({ stream, sessionId }: { stream: ChatStream; sessionId: string }) {
  const err = stream.error;
  if (!err) return null;
  const tools = streamTools(stream);
  const report = [
    "AgentOS chat stream failed",
    `message:  ${err.message}`,
    err.detail && `detail:   ${err.detail}`,
    `session:  ${sessionId}`,
    `at:       ${new Date(err.at).toISOString()}`,
    `steps:    ${stream.parts.length}`,
    `reply:    ${streamText(stream).length} chars before the failure`,
    tools.length > 0 &&
      `tools:    ${tools.map((t) => `${t.name}=${toolOutcome(t.success)}`).join(", ")}`,
    stream.warnings?.length && `warnings: ${stream.warnings.join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Callout
      role="alert"
      tone="danger"
      title="The reply failed"
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => void copyText(report, "Error details")}>
            Copy details
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dismissChatStream(sessionId)}>
            Dismiss
          </Button>
        </>
      }
    >
      <p className="text-foreground">{err.message}</p>
      {err.detail && <p className="mt-0.5 font-mono text-xs">{err.detail}</p>}
      {stream.warnings && stream.warnings.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
          {stream.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {stream.parts.length > 0 && (
        <p className="mt-1.5 text-xs">Everything above this notice arrived before the failure.</p>
      )}
    </Callout>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="group flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end gap-1">
        <div className="whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-accent px-3.5 py-2 text-[15px] leading-relaxed text-foreground">
          {text}
        </div>
        <div className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton text={text} label="Copy message" />
        </div>
      </div>
    </div>
  );
}

/**
 * Assistant turns are not bubbles: full-column prose next to an avatar, the way
 * every modern assistant renders them. Markdown (tables, fences) gets the width
 * it needs and long answers stay readable.
 */
function AssistantTurn({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="group flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {children}
        {footer}
      </div>
    </div>
  );
}

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center gap-8 py-10 text-center">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">How can I help?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask in plain words. I can read your files, search the web, set reminders and more.
        </p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map(({ icon: Icon, text }) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-card px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The floating input. Shared by a live conversation and an unopened one. */
function Composer({
  formRef,
  value,
  onValueChange,
  onSubmit,
  onStop,
  busy,
}: {
  formRef: RefObject<HTMLFormElement>;
  value: string;
  onValueChange: (v: string) => void;
  onSubmit: () => void;
  /** Present only while a reply is streaming — swaps Send for Stop. */
  onStop?: () => void;
  busy?: boolean;
}) {
  return (
    <div className={cn(COLUMN, "pb-4")}>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex items-end gap-2 rounded-lg border border-border bg-card p-1.5 pl-3 transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25"
      >
        <MentionTextarea
          autoGrow
          value={value}
          onValueChange={onValueChange}
          placeholder="Ask anything — @ to attach a file"
          containerClassName="flex-1"
          className="max-h-52 min-h-[24px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-0 py-1.5 text-[15px] shadow-none focus-visible:ring-0"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        {onStop ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="shrink-0"
            title="Stop generating"
            aria-label="Stop generating"
            onClick={onStop}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="shrink-0"
            disabled={!value.trim() || busy}
            title="Send"
            aria-label="Send"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        )}
      </form>
      <p className="mt-1.5 text-center text-xs text-muted-foreground">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}

/**
 * A chat that doesn't exist yet. The session row is written when you actually
 * send something — opening one eagerly left empty sessions in the list (and the
 * API rejects a create with no first message).
 */
function DraftConversation({
  agentName,
  railOpen,
  onToggleRail,
  onOpened,
}: {
  agentName: string;
  railOpen: boolean;
  onToggleRail: () => void;
  onOpened: (session: ChatSessionSummary, text: string) => void;
}) {
  const create = useCreateChatSession();
  const [text, setText] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function submit() {
    const t = text.trim();
    if (!t || !agentName || create.isPending) return;
    // Clear NOW, like the live composer does. Clearing inside `.then` runs a
    // round trip after Enter and wipes whatever was typed while the session was
    // being created. On failure the text comes back — unless something newer is
    // already in the box.
    setText("");
    create
      .mutateAsync({ agent_name: agentName })
      .then((res) => {
        onOpened(
          {
            id: res.id,
            agent_name: agentName,
            title: null,
            preview: t,
            message_count: 0,
            updated_at: new Date().toISOString(),
          },
          t,
        );
      })
      .catch((e) => {
        setText((cur) => (cur.trim() ? cur : t));
        toastError(e);
      });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="z-10 flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
        <Button
          variant="ghost"
          size="icon"
          title={railOpen ? "Hide chats" : "Show chats"}
          onClick={onToggleRail}
        >
          {railOpen ? <PanelLeftClose /> : <PanelLeft />}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">New chat</p>
          {agentName && <p className="truncate text-xs text-muted-foreground">{agentName}</p>}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(COLUMN, "py-6")}>
          <EmptyChat
            onPick={(t) => {
              setText(t + " ");
              formRef.current?.querySelector("textarea")?.focus();
            }}
          />
        </div>
      </div>
      <div className="relative shrink-0">
        <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
        <Composer
          formRef={formRef}
          value={text}
          onValueChange={setText}
          onSubmit={submit}
          busy={create.isPending}
        />
      </div>
    </div>
  );
}

function Conversation({
  session,
  railOpen,
  onToggleRail,
  onDeleted,
  onForked,
}: {
  session: ChatSessionSummary;
  railOpen: boolean;
  onToggleRail: () => void;
  /** Carries the id so the page can drop it from the still-stale sessions list. */
  onDeleted: (id: string) => void;
  onForked: (id: string) => void;
}) {
  const sessionId = session.id;
  // The stream lives in a module store, so it survives this component
  // unmounting (page change / session switch) and is still here on return.
  const streaming = useChatStreamStore((s) => s.streams[sessionId]);
  // "Generating" is stricter than "bubble on screen": after Stop, done, or a
  // failure the bubble stays until the transcript replaces it (or, on the error
  // path, until Dismiss) but the composer is free — and, crucially, so are the
  // refetches below. Keying them off "an entry exists" left a failed turn that
  // nobody dismissed with refetch-on-focus/mount/reconnect off and the `chat`
  // channel unsubscribed FOREVER: that session's transcript would never update
  // again.
  const generating = Boolean(streaming && !streaming.done);
  // Pause focus-refetch while generating: the kernel persists the user turn
  // before inference, so a refetch mid-stream would render it twice.
  const messages = useChatMessages(sessionId, generating);
  // A turn written by another tab (or a channel bridge) arrives on the kernel's
  // `chat` channel. Skipped while this tab is streaming — it renders its own
  // turn locally and a refetch would duplicate it.
  useInvalidateOnEvent(
    generating ? null : "chat",
    [chatKeys.messages(sessionId), chatKeys.sessions],
    { debounceMs: 300 },
  );
  const del = useDeleteChatSession();
  const rename = useRenameChatSession();
  const fork = useForkChatSession();
  const [text, setText] = useState("");
  // Survives the handover to the transcript, which carries no tokens/cost.
  const lastUsage = useChatStreamStore((s) => s.turnUsage[sessionId]);
  // Survives the handover for the same reason the cost does — the transcript has
  // nowhere to put it. Only the newest turn keeps it, and only until a reload.
  const lastThoughts = useChatStreamStore((s) => s.turnThinking[sessionId]);
  const failedText = useChatStreamStore((s) => s.failed[sessionId]);
  const failedAt = useChatStreamStore((s) => s.failedAt[sessionId]);
  const { viewportRef, contentRef, onScroll, showJump, scrollToBottom } = useStickToBottom();
  // Once the transcript holds the turn being streamed (a refetch landed
  // mid-reply), the persisted row replaces the local echo — never both.
  const echoed = Boolean(
    streaming && lastUserTurn(messages.data?.items)?.content.trim() === streaming.user.trim(),
  );
  // Same guard for the reply. It matters on two paths: the frame between the
  // handover refetch resolving and the entry being dropped, and a failed turn
  // whose bubble deliberately stays up — if the kernel persisted the partial
  // answer anyway, it must not appear twice.
  const streamedText = streaming ? streamText(streaming).trim() : "";
  // ONLY the newest reply. Scanning every assistant message matched an older
  // identical one — a canned refusal, a repeated tool error — the instant the
  // new reply grew into the same string, and the live turn blanked itself just
  // as it finished (taking any pending approval card with it).
  const replyEchoed = Boolean(
    streamedText && lastTurn(messages.data?.items, "assistant")?.content.trim() === streamedText,
  );
  // ponytail: MentionTextarea owns its own ref and doesn't forward one; reach
  // the textarea through the form we render rather than rewiring a shared component.
  const formRef = useRef<HTMLFormElement>(null);

  // Opening a conversation starts at the newest message, with no scroll animation.
  useLayoutEffect(() => {
    scrollToBottom("auto");
  }, [sessionId, scrollToBottom]);

  // Following new content is the ResizeObserver's job (see `useStickToBottom`):
  // re-sticking on `messages.data` fired while `QueryState`'s AnimatePresence
  // still had only the skeleton mounted, so it measured that instead of the
  // transcript — the view sat at the top and teleported on the next token.

  // A send that failed (here or while we were unmounted) parks its text for
  // the composer — but never clobber text typed since, and never restore a
  // turn the kernel already persisted (it writes the user turn before
  // inference): resending that would duplicate it. So wait for the transcript
  // refetch that `fail()` triggers, then look at the last user message.
  useEffect(() => {
    if (!failedText) return;
    const refetched =
      failedAt != null &&
      (messages.dataUpdatedAt >= failedAt || messages.errorUpdatedAt >= failedAt);
    if (!refetched) return;
    const lastUser = lastUserTurn(messages.data?.items);
    const persisted = lastUser?.content.trim() === failedText.trim();
    if (persisted) {
      toast.message("Your message was saved, but the reply failed.", {
        description: "Send a follow-up to continue — resending it would post it twice.",
      });
    } else {
      setText((cur) => (cur.trim() ? cur : failedText));
    }
    consumeFailedChatText(sessionId);
  }, [
    failedText,
    failedAt,
    sessionId,
    messages.dataUpdatedAt,
    messages.errorUpdatedAt,
    messages.data,
  ]);

  function focusComposer() {
    formRef.current?.querySelector("textarea")?.focus();
  }

  function submit() {
    const t = text.trim();
    if (!t || generating) return;
    setText("");
    startChatStream(sessionId, t);
    // "auto", not the default smooth: the scroll events an animation emits on
    // the way down unpin the viewport and flash "Jump to latest" mid-send.
    scrollToBottom("auto");
  }

  async function onRename() {
    const title = await promptText({
      title: "Rename chat",
      confirmLabel: "Rename",
      input: { defaultValue: session.title ?? "", placeholder: "Chat title", label: "Chat title" },
    });
    // Empty would blank the title for good; unchanged is a no-op.
    if (!title || title === session.title) return;
    rename.mutateAsync({ id: sessionId, title }).catch(toastError);
  }

  function onFork() {
    fork
      .mutateAsync(sessionId)
      .then((res) => {
        toast.success("Forked");
        onForked(res.id);
      })
      .catch(toastError);
  }

  async function onDelete() {
    if (!(await confirm({ title: "Delete chat?", destructive: true, confirmLabel: "Delete" })))
      return;
    // The session is going away — nothing left for an in-flight stream to write to.
    abortChatStream(sessionId);
    del
      .mutateAsync(sessionId)
      .then(() => {
        onDeleted(sessionId);
        toast.success("Deleted");
      })
      .catch(toastError);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="z-10 flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
        <Button
          variant="ghost"
          size="icon"
          title={railOpen ? "Hide chats" : "Show chats"}
          onClick={onToggleRail}
        >
          {railOpen ? <PanelLeftClose /> : <PanelLeft />}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{session.title ?? session.agent_name}</p>
          {session.title && (
            <p className="truncate text-xs text-muted-foreground">{session.agent_name}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" title="Rename" onClick={() => void onRename()}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Fork" onClick={onFork}>
          <GitFork className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Export markdown"
          onClick={() => exportChatSession(sessionId, "markdown").catch(toastError)}
        >
          <Download className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Delete" onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </header>

      {/* role="log" + polite: without it a screen-reader user gets no signal
          that a reply started or landed — the transcript just changes silently. */}
      <div
        ref={viewportRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div ref={contentRef} className={cn(COLUMN, "flex flex-col gap-6 py-6")}>
          <QueryState query={messages} skeleton={<Skeleton className="h-20 w-full" />}>
            {(data) => {
              // A session always carries rows the transcript shouldn't show —
              // the system prompt, and empty user/assistant rows from tool-only
              // iterations. Drop them BEFORE deciding the chat looks empty, or a
              // fresh chat renders a blank pane instead of the greeting.
              const visible = data.items
                .filter(
                  (m) =>
                    m.role === "tool" ||
                    ((m.role === "user" || m.role === "assistant") && m.content.trim().length > 0),
                )
                .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
              return visible.length === 0 && !streaming ? (
                <EmptyChat
                  onPick={(t) => {
                    setText(t + " ");
                    focusComposer();
                  }}
                />
              ) : (
                // Keyed on the row, not its index: the list is filtered and
                // sorted, so an assistant row that was persisted empty (a
                // tool-only iteration) and later filled in shifts every index
                // after it — handing an expanded ToolCallCard's open state to a
                // different call. `ChatMessage` carries no id; timestamp+role is
                // the stable pair the transcript actually has.
                withRowKeys(visible).map(({ m, key }, i, rows) => (
                  <motion.div key={key} {...bubbleMotion}>
                    {m.role === "tool" ? (
                      <div className="pl-10">
                        <ToolCallCard m={m} />
                      </div>
                    ) : m.role === "user" ? (
                      <UserBubble text={m.content} />
                    ) : (
                      <AssistantTurn
                        footer={
                          <div className="flex items-center gap-2">
                            <div className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                              <CopyButton text={m.content} label="Copy reply" />
                            </div>
                            {/* Only under the newest reply, and only while it is
                                the turn those numbers came from. */}
                            {!streaming && i === rows.length - 1 && (
                              <UsageFooter usage={lastUsage} />
                            )}
                          </div>
                        }
                      >
                        {/* Same placement rule as the usage footer: the newest
                            reply is the only row those steps belong to. */}
                        {!streaming && i === rows.length - 1 && (
                          <HandedOverThoughts thoughts={lastThoughts} />
                        )}
                        <Markdown className="text-[15px]">{m.content}</Markdown>
                      </AssistantTurn>
                    )}
                  </motion.div>
                ))
              );
            }}
          </QueryState>

          {streaming && (
            <>
              {!echoed && (
                <motion.div {...bubbleMotion}>
                  <UserBubble text={streaming.user} />
                </motion.div>
              )}
              {(!replyEchoed || streaming.error) && (
                <motion.div {...bubbleMotion}>
                  <AssistantTurn
                    footer={
                      <div className="flex items-center gap-2">
                        {!generating && streamedText && (
                          <div className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                            <CopyButton text={streamText(streaming)} label="Copy reply" />
                          </div>
                        )}
                        <UsageFooter usage={streaming.usage} />
                      </div>
                    }
                  >
                    {!replyEchoed && (
                      <StreamParts stream={streaming} generating={generating} />
                    )}
                    {/* Nothing has arrived yet: the request is out, the first
                        frame is not. */}
                    {streaming.parts.length === 0 && generating && <TypingDots />}
                    {/* A turn can end cleanly with no text at all — every
                        iteration was a tool call, or the model returned empty.
                        Silence with no explanation reads as a bug. */}
                    {!generating && !streaming.error && !streamedText && (
                      <p className="text-sm text-muted-foreground">
                        The assistant finished without writing a reply.
                      </p>
                    )}
                    <StreamErrorCard stream={streaming} sessionId={sessionId} />
                    <HumanInLoop stream={streaming} />
                  </AssistantTurn>
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="relative shrink-0">
        {/* Content scrolls out under the composer instead of stopping at a hard edge. */}
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
        <Composer
          formRef={formRef}
          value={text}
          onValueChange={setText}
          onSubmit={submit}
          onStop={generating ? () => stopChatStream(sessionId) : undefined}
        />
      </div>
    </div>
  );
}

const AGENT_KEY = "agentos-panel:chat-agent";
const RAIL_KEY = "agentos-panel:chat-rail";

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the choice still applies for this page
  }
}

export function ChatPage() {
  const sessions = useChatSessions();
  const agents = useAgents();
  const reduced = useReducedMotion();
  // Coming back to the page mid-reply reopens whichever chat is still streaming.
  const [selected, setSelected] = useState<string | null>(
    () => Object.keys(useChatStreamStore.getState().streams)[0] ?? null,
  );
  const [agent, setAgent] = useState(() => readStored(AGENT_KEY, ""));
  const [railOpen, setRailOpen] = useState(() => readStored(RAIL_KEY, "1") === "1");
  const narrow = useIsNarrow();
  // "New chat" opens a draft — nothing is written until the first send.
  const [draft, setDraft] = useState(false);
  // A session we just created, kept until the list query catches up: without it
  // `selected` names an id the list doesn't have yet and the pane falls back to
  // the wrong conversation for the length of a refetch.
  const [opened, setOpened] = useState<ChatSessionSummary | null>(null);
  // The mirror image of `opened`: a session we just deleted is still in the
  // cached list until the refetch lands, and with `selected` cleared the pane
  // falls back to `items[0]` — which can be the row that was just deleted.
  const [deleted, setDeleted] = useState<string | null>(null);

  const fetched = useMemo(() => sessions.data?.items ?? [], [sessions.data]);
  const items = useMemo(() => {
    const list =
      opened && !fetched.some((s) => s.id === opened.id) ? [opened, ...fetched] : fetched;
    return deleted ? list.filter((s) => s.id !== deleted) : list;
  }, [fetched, opened, deleted]);
  // Chat is home: with nothing selected, land in the latest conversation.
  const current = selected ? (items.find((s) => s.id === selected) ?? null) : (items[0] ?? null);

  // Resolve the agent to talk to: remembered choice if it still exists, else
  // the first online agent, else the first agent.
  const agentList = agents.data ?? [];
  const agentName = agentList.some((a) => a.name === agent)
    ? agent
    : ((agentList.find((a) => a.status !== "offline") ?? agentList[0])?.name ?? "");

  function pickAgent(name: string) {
    setAgent(name);
    writeStored(AGENT_KEY, name);
  }

  function toggleRail() {
    setRailOpen((o) => {
      writeStored(RAIL_KEY, o ? "0" : "1");
      return !o;
    });
  }

  function openSession(id: string) {
    setDraft(false);
    setSelected(id);
    // Picking a chat in the floating rail should hand the pane back.
    if (narrow) setRailOpen(false);
  }

  const noAgents = agents.isSuccess && agentList.length === 0;
  // Nothing to read yet (fresh install, or every chat deleted): go straight to
  // the draft composer rather than an empty pane behind a button.
  const showDraft = (draft || (sessions.isSuccess && items.length === 0)) && !noAgents;
  // The only rail toggle lives in a conversation header — with neither pane
  // rendered, a collapsed rail would hide "New chat" with no way back.
  const showRail = railOpen || (!current && !showDraft);
  // Below `md` the 264px rail would leave the conversation ~120px wide, which no
  // amount of wrapping saves — so it FLOATS over the pane there instead of eating
  // its width. Suppressing it outright is what the first pass did, and that made
  // the header toggle a dead button: `current` falls back to `items[0]`, so the
  // forced-open branch above never fires once a session exists.
  const overlay = narrow && showRail;

  // Not persisted: this is the viewport talking, not the operator, so rotating
  // back to a wide screen must not have silently changed their preference.
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

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* The shell's PageHeader is gone here — chat owns the viewport — so the
          route still needs a name for screen readers and the nav landmark. */}
      <h1 className="sr-only">Chat</h1>
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
        <div className="w-[264px] space-y-2 border-b border-border p-3">
          <Button
            className="w-full justify-start"
            onClick={() => {
              setDraft(true);
              setSelected(null);
            }}
            disabled={!agentName}
          >
            <Plus /> New chat
          </Button>
          <Select
            aria-label="Agent"
            value={agentName}
            onChange={(e) => pickAgent(e.target.value)}
            disabled={agentList.length === 0}
            className="w-full text-xs"
          >
            {agentList.length === 0 && <option value="">No agents</option>}
            {agentList.map((a) => (
              <option key={a.id} value={a.name}>
                {a.name} · {a.model}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[264px] flex-1 overflow-y-auto p-2">
          {sessions.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No chats yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => openSession(s.id)}
                    aria-current={current?.id === s.id ? "true" : undefined}
                    className={cn(
                      "relative w-full cursor-pointer rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      current?.id === s.id
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <span className="relative z-10 block truncate font-medium text-foreground">
                      {s.title ?? s.agent_name}
                    </span>
                    <span className="relative z-10 block truncate text-xs text-muted-foreground">
                      {stripMarkdown(s.preview) || "—"}
                    </span>
                    <span className="relative z-10 mt-0.5 block truncate text-xs text-muted-foreground">
                      {s.message_count} msg · {relativeTime(s.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.aside>

      {showDraft ? (
        <DraftConversation
          agentName={agentName}
          railOpen={showRail}
          onToggleRail={toggleRail}
          onOpened={(session, text) => {
            setOpened(session);
            openSession(session.id);
            startChatStream(session.id, text);
          }}
        />
      ) : current ? (
        <Conversation
          key={current.id}
          session={current}
          railOpen={showRail}
          onToggleRail={toggleRail}
          onDeleted={(id) => {
            setDeleted(id);
            setSelected(null);
            setOpened(null);
          }}
          onForked={openSession}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {noAgents ? (
            <EmptyState
              icon={Bot}
              title="No assistants yet"
              description="Set one up and you can start chatting right here."
              action={
                <Button asChild>
                  <Link to="/welcome">Set up an assistant</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="Start a chat"
              description="Pick an agent on the left and hit New chat."
              action={<Button onClick={() => setDraft(true)}>New chat</Button>}
            />
          )}
        </div>
      )}
    </div>
  );
}
