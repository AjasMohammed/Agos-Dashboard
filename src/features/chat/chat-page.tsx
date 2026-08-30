import {
  useEffect,
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
} from "@/api/queries/chat";
import {
  abortChatStream,
  consumeFailedChatText,
  startChatStream,
  stopChatStream,
  useChatStreamStore,
} from "./stream-store";
import { useStickToBottom } from "./stick-to-bottom";
import { stripMarkdown } from "@/lib/preview-text";
import { useAgents } from "@/api/queries/agents";
import { HumanInLoop } from "./human-in-loop";
import { Markdown } from "@/components/markdown";
import { MentionTextarea } from "@/components/mention-textarea";
import { EmptyState } from "@/components/empty-state";
import { EASE_OUT } from "@/components/motion";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: EASE_OUT },
} as const;

/** The reading column. Everything else (rail, header, composer) frames it. */
const COLUMN = "mx-auto w-full max-w-3xl px-4";


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

function AssistantAvatar() {
  return (
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-glow">
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
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
    <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/40 text-xs">
      <Tag
        {...(onClick ? { type: "button" as const, onClick, "aria-expanded": open } : {})}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/70"
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
            <div className="space-y-2 border-t border-border/70 p-2.5">{children}</div>
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
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 p-2 font-mono">
            {payload}
          </pre>
        </div>
      )}
      {result && (
        <div>
          <p className="mb-1 font-medium text-muted-foreground">What came back</p>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 p-2 font-mono">
            {result}
          </pre>
        </div>
      )}
      {!payload && !result && <p className="text-muted-foreground">Nothing recorded.</p>}
    </ToolPill>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="group flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end gap-1">
        <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground shadow-sm">
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
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
      >
        <h2 className="text-gradient text-3xl font-semibold tracking-tight sm:text-4xl">
          How can I help?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask in plain words. I can read your files, search the web, set reminders and more.
        </p>
      </motion.div>
      <motion.div
        className="grid w-full gap-2 sm:grid-cols-2"
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
        }}
      >
        {SUGGESTIONS.map(({ icon: Icon, text }) => (
          <motion.button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            variants={{
              hidden: { opacity: 0, y: 10 },
              show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_OUT } },
            }}
            whileHover={{ y: -2 }}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/50"
          >
            <Icon className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">{text}</span>
          </motion.button>
        ))}
      </motion.div>
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
        className="flex items-end gap-2 rounded-3xl border border-border bg-card p-2 pl-4 shadow-card transition-shadow duration-200 focus-within:border-primary/40 focus-within:shadow-glow"
      >
        <MentionTextarea
          autoGrow
          value={value}
          onValueChange={onValueChange}
          placeholder="Ask anything — @ to attach a file"
          containerClassName="flex-1"
          className="max-h-52 min-h-[24px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-0 py-2 text-[15px] shadow-none focus-visible:ring-0"
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
            className="size-9 shrink-0 rounded-full"
            title="Stop generating"
            onClick={onStop}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0 rounded-full transition-transform active:scale-95"
            disabled={!value.trim() || busy}
            title="Send"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        )}
      </form>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="glass z-10 flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
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
          {agentName && <p className="truncate text-[11px] text-muted-foreground">{agentName}</p>}
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
  const messages = useChatMessages(sessionId);
  const del = useDeleteChatSession();
  const rename = useRenameChatSession();
  const fork = useForkChatSession();
  const [text, setText] = useState("");
  // The stream lives in a module store, so it survives this component
  // unmounting (page change / session switch) and is still here on return.
  const streaming = useChatStreamStore((s) => s.streams[sessionId]);
  const failedText = useChatStreamStore((s) => s.failed[sessionId]);
  const { viewportRef, contentRef, onScroll, showJump, scrollToBottom } = useStickToBottom();
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
  // the composer — but never clobber text typed since.
  useEffect(() => {
    if (!failedText) return;
    setText((cur) => (cur.trim() ? cur : failedText));
    consumeFailedChatText(sessionId);
  }, [failedText, sessionId]);

  function focusComposer() {
    formRef.current?.querySelector("textarea")?.focus();
  }

  function submit() {
    const t = text.trim();
    if (!t || streaming) return;
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
    if (title == null) return;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="glass z-10 flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
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
            <p className="truncate text-[11px] text-muted-foreground">{session.agent_name}</p>
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
                withRowKeys(visible).map(({ m, key }) => (
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
                          <div className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                            <CopyButton text={m.content} label="Copy reply" />
                          </div>
                        }
                      >
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
              <motion.div {...bubbleMotion}>
                <UserBubble text={streaming.user} />
              </motion.div>
              <motion.div {...bubbleMotion}>
                <AssistantTurn>
                  {streaming.tools.map((t, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: EASE_OUT }}
                      className="mb-1.5"
                    >
                      {/* undefined until `tool_result` settles it — the spinner state. */}
                      <ToolPill name={t.name} success={t.success} />
                    </motion.div>
                  ))}
                  {streaming.assistant ? (
                    <Markdown className="streaming text-[15px]">{streaming.assistant}</Markdown>
                  ) : (
                    <TypingDots />
                  )}
                  <HumanInLoop stream={streaming} />
                </AssistantTurn>
              </motion.div>
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
              className="absolute -top-11 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-card hover:bg-accent"
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
          onStop={streaming ? () => stopChatStream(sessionId) : undefined}
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
  }

  const noAgents = agents.isSuccess && agentList.length === 0;
  // Nothing to read yet (fresh install, or every chat deleted): go straight to
  // the draft composer rather than an empty pane behind a button.
  const showDraft = (draft || (sessions.isSuccess && items.length === 0)) && !noAgents;
  // The only rail toggle lives in a conversation header — with neither pane
  // rendered, a collapsed rail would hide "New chat" with no way back.
  const showRail = railOpen || (!current && !showDraft);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* The shell's PageHeader is gone here — chat owns the viewport — so the
          route still needs a name for screen readers and the nav landmark. */}
      <h1 className="sr-only">Chat</h1>
      <motion.aside
        animate={{ width: showRail ? 264 : 0 }}
        initial={false}
        transition={reduced ? { duration: 0 } : { duration: 0.25, ease: EASE_OUT }}
        className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-card/30"
      >
        <div className="w-[264px] space-y-2 border-b border-border p-3">
          <Button
            className="w-full justify-start rounded-xl"
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
            className="h-8 w-full text-xs"
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
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
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
                    className={cn(
                      "relative w-full rounded-xl px-3 py-2 text-left text-sm transition-colors",
                      current?.id === s.id
                        ? "text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    {current?.id === s.id && (
                      <motion.span
                        layoutId="chat-session-active"
                        className="absolute inset-0 rounded-xl bg-accent"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                      />
                    )}
                    <span className="relative z-10 block truncate font-medium text-foreground">
                      {s.title ?? s.agent_name}
                    </span>
                    <span className="relative z-10 block truncate text-xs text-muted-foreground">
                      {stripMarkdown(s.preview) || "—"}
                    </span>
                    <span className="relative z-10 mt-0.5 block truncate text-[10px] text-muted-foreground">
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
