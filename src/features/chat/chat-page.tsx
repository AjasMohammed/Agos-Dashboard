import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Plus,
  Send,
  Trash2,
  MessagesSquare,
  GitFork,
  Download,
  Pencil,
  Wrench,
  Loader2,
  ChevronRight,
  CircleCheck,
  CircleX,
} from "lucide-react";
import { toast } from "sonner";
import {
  useChatSessions,
  useChatMessages,
  useCreateChatSession,
  useDeleteChatSession,
  useRenameChatSession,
  useForkChatSession,
  streamChatMessage,
  exportChatSession,
  chatKeys,
} from "@/api/queries/chat";
import { useAgents } from "@/api/queries/agents";
import { Markdown } from "@/components/markdown";
import { MentionTextarea } from "@/components/mention-textarea";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatSessionSummary } from "@/api/models";

/** Bubble entrance shared by history, streaming echo, and typing indicator. */
const bubbleMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2 },
} as const;

/**
 * Abort a stream when no BYTES arrive for this long (re-armed via onActivity on
 * every read, so thinking events and keepalives count as liveness). Catches
 * genuinely dead connections — a proxy drop with no error frame — which
 * otherwise leave the composer disabled forever.
 */
const STREAM_IDLE_MS = 120_000;

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </span>
  );
}

function prettyJson(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function duration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Status icon for a tool call: spinner while running, check/cross once settled. */
function ToolStatusIcon({ success }: { success: boolean | null | undefined }) {
  if (success == null) return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
  return success ? (
    <CircleCheck className="size-3.5 text-emerald-500" />
  ) : (
    <CircleX className="size-3.5 text-destructive" />
  );
}

/** Collapsible card for a persisted role="tool" message. */
function ToolCallCard({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const payload = prettyJson(m.tool_payload_json);
  const result = prettyJson(m.tool_result_json);
  return (
    <div className="mx-auto w-full max-w-[90%] rounded-md border border-border bg-muted/50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 p-2 text-left"
        aria-expanded={open}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{m.tool_name ?? "tool"}</span>
        {m.tool_intent_type && <Badge variant="muted">{m.tool_intent_type}</Badge>}
        {duration(m.tool_duration_ms) && (
          <span className="text-muted-foreground">{duration(m.tool_duration_ms)}</span>
        )}
        <ToolStatusIcon success={m.tool_success ?? true} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-2">
          {payload && (
            <div>
              <p className="mb-1 font-medium text-muted-foreground">Input</p>
              <pre className="max-h-48 overflow-auto rounded bg-background/60 p-2 font-mono">{payload}</pre>
            </div>
          )}
          {result && (
            <div>
              <p className="mb-1 font-medium text-muted-foreground">Result</p>
              <pre className="max-h-64 overflow-auto rounded bg-background/60 p-2 font-mono">{result}</pre>
            </div>
          )}
          {!payload && !result && <p className="text-muted-foreground">No payload recorded.</p>}
        </div>
      )}
    </div>
  );
}

function NewChatDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState("");
  const agents = useAgents();
  const create = useCreateChatSession();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await create.mutateAsync({
        agent_name: agent || (agents.data?.[0]?.name ?? ""),
      });
      onCreated(res.id);
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> New chat
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>Start a conversation with an agent.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">{agents.data?.length ? "Select agent…" : "No agents"}</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={a.name}>
                {a.name} ({a.model})
              </option>
            ))}
          </Select>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !(agent || agents.data?.length)}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Conversation({
  session,
  onDeleted,
  onForked,
}: {
  session: ChatSessionSummary;
  onDeleted: () => void;
  onForked: (id: string) => void;
}) {
  const sessionId = session.id;
  const messages = useChatMessages(sessionId);
  const qc = useQueryClient();
  const del = useDeleteChatSession();
  const rename = useRenameChatSession();
  const fork = useForkChatSession();
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState<{
    user: string;
    assistant: string;
    tools: { name: string; success?: boolean }[];
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data, streaming]);

  // Abort any in-flight stream when this conversation unmounts (session switch/delete),
  // so we don't update an orphaned component or leak the background fetch.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function submit() {
    const t = text.trim();
    if (!t || streaming) return;
    setText("");
    setStreaming({ user: t, assistant: "", tools: [] });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Watchdog: a dropped connection can end the stream without a done/error
    // frame, which would leave `streaming` set (composer disabled) forever.
    // Re-armed on every event; on firing it does exactly what onError does.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        toastError(new Error("Stream stalled — connection lost"));
        setStreaming(null);
        // Restore the failed message, but never clobber text typed mid-stream.
        setText((cur) => (cur.trim() ? cur : t));
        controller.abort();
      }, STREAM_IDLE_MS);
    };
    // Any abort (watchdog, unmount, session switch) also kills the timer.
    controller.signal.addEventListener("abort", () => {
      if (idleTimer) clearTimeout(idleTimer);
    });
    armIdle();
    await streamChatMessage(
      sessionId,
      t,
      {
        onActivity: armIdle,
        onChunk: (chunk) => setStreaming((s) => (s ? { ...s, assistant: s.assistant + chunk } : s)),
        onToolStart: (name) =>
          setStreaming((s) => (s ? { ...s, tools: [...s.tools, { name }] } : s)),
        onTool: (name, success) =>
          setStreaming((s) => {
            if (!s) return s;
            // Settle the most recent still-running call for this tool.
            const tools = [...s.tools];
            for (let i = tools.length - 1; i >= 0; i--) {
              if (tools[i].name === name && tools[i].success === undefined) {
                tools[i] = { name, success };
                return { ...s, tools };
              }
            }
            return { ...s, tools: [...tools, { name, success }] };
          }),
        onDone: () => {
          if (idleTimer) clearTimeout(idleTimer);
          setStreaming(null);
          qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
          qc.invalidateQueries({ queryKey: chatKeys.sessions });
        },
        onError: (msg) => {
          if (idleTimer) clearTimeout(idleTimer);
          toastError(new Error(msg));
          setStreaming(null);
          // Restore the failed message, but never clobber text typed mid-stream.
          setText((cur) => (cur.trim() ? cur : t));
        },
      },
      controller.signal,
    );
  }

  function onSend(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  function onRename() {
    const title = window.prompt("Rename chat", session.title ?? "");
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
    if (!(await confirm({ title: "Delete chat?", destructive: true, confirmLabel: "Delete" }))) return;
    del
      .mutateAsync(sessionId)
      .then(() => {
        onDeleted();
        toast.success("Deleted");
      })
      .catch(toastError);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{session.title ?? session.agent_name}</p>
        <Button variant="ghost" size="icon" title="Rename" onClick={onRename}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Fork" onClick={onFork}>
          <GitFork className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Export markdown" onClick={() => exportChatSession(sessionId, "markdown").catch(toastError)}>
          <Download className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Delete" onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <QueryState query={messages} skeleton={<Skeleton className="h-20 w-full" />}>
          {(data) =>
            [...data.items]
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
              .map((m, i) => {
                if (m.role === "tool") {
                  return (
                    <motion.div key={i} {...bubbleMotion} className="flex">
                      <ToolCallCard m={m} />
                    </motion.div>
                  );
                }
                const mine = m.role === "user";
                return (
                  <motion.div
                    key={i}
                    {...bubbleMotion}
                    className={cn("flex", mine ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm",
                        mine
                          ? "whitespace-pre-wrap rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-muted",
                      )}
                    >
                      {mine ? m.content : <Markdown>{m.content}</Markdown>}
                    </div>
                  </motion.div>
                );
              })
          }
        </QueryState>
        {streaming && (
          <>
            <motion.div {...bubbleMotion} className="flex justify-end">
              <div className="max-w-[75%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground shadow-sm">
                {streaming.user}
              </div>
            </motion.div>
            <motion.div {...bubbleMotion} className="flex justify-start">
              <div className="max-w-[75%] space-y-1.5 rounded-lg rounded-bl-sm bg-muted px-3 py-2 text-sm shadow-sm">
                {streaming.tools.map((t, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ToolStatusIcon success={t.success} />
                    <Wrench className="size-3" />
                    {t.name}
                  </span>
                ))}
                {streaming.assistant ? <Markdown>{streaming.assistant}</Markdown> : <TypingDots />}
              </div>
            </motion.div>
          </>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={onSend} className="flex items-end gap-2 border-t border-border p-3">
        <MentionTextarea
          value={text}
          onValueChange={setText}
          placeholder="Message… (@ mentions an uploaded file; streams the reply)"
          containerClassName="flex-1"
          className="min-h-[44px] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button type="submit" size="icon" disabled={!!streaming || !text.trim()}>
          {streaming ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
    </div>
  );
}

export function ChatPage() {
  const sessions = useChatSessions();
  const [selected, setSelected] = useState<string | null>(null);
  const items = sessions.data?.items ?? [];
  const current = items.find((s) => s.id === selected) ?? null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Chat"
        description="Persisted conversations with your agents."
        actions={<NewChatDialog onCreated={setSelected} />}
      />
      <div className="grid h-[calc(100vh-12rem)] grid-cols-[280px_1fr] gap-4 pb-6">
        <div className="overflow-y-auto rounded-lg border border-border">
          {sessions.isPending ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No chats yet.</p>
          ) : (
            <ul>
              {items.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelected(s.id)}
                    className={cn(
                      "relative flex w-full items-start gap-2 border-b border-border p-3 text-left text-sm transition-colors hover:bg-muted/50",
                      selected === s.id && "bg-muted",
                    )}
                  >
                    {selected === s.id && (
                      <motion.span
                        layoutId="chat-session-active"
                        className="absolute inset-y-0 left-0 w-0.5 bg-primary"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.title ?? s.agent_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.preview ?? "—"}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {s.agent_name} · {s.message_count} msg · {relativeTime(s.updated_at)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border">
          {current ? (
            <Conversation
              key={current.id}
              session={current}
              onDeleted={() => setSelected(null)}
              onForked={setSelected}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={MessagesSquare}
                title="Select a chat"
                description="Pick a conversation or start a new one."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
