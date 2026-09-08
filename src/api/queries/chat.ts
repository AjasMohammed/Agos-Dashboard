import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap, unwrapList, authedFetch } from "../client";
import type { ChatSessionSummary, ChatMessage } from "../models";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/**
 * These two must not prefix one another. `invalidateQueries` matches by prefix
 * and defaults to `cancelRefetch: true`, so while `sessions` was
 * `["chat","sessions"]` — a strict prefix of `messages(id)` — refreshing the
 * session list at the end of a turn cancelled the awaited transcript refetch
 * and the streamed reply blinked out.
 */
export const chatKeys = {
  sessions: ["chat", "session-list"] as const,
  messages: (id: string) => ["chat", "session", id, "messages"] as const,
};

/** The `done` frame's tail: what the turn cost and, as a backstop, its full text. */
export interface StreamSummary {
  /** The complete answer the kernel assembled. Gateway turns emit this with no chunks. */
  answer?: string;
  /** Agent-loop passes the turn took. */
  iterations?: number;
  tokens?: number;
  costUsd?: number;
}

export interface StreamHandlers {
  onChunk: (text: string) => void;
  /**
   * The kernel's `Thinking` frame. With no `text` it is a pass marker ("pass 2
   * started"); with `text` it is one delta of the model's reasoning, which only
   * some providers expose. Both shapes arrive on the same event name, so a turn
   * can be marker-only, marker-then-prose, or (on a gateway agent) neither.
   */
  onThinking?: (iteration: number, text?: string) => void;
  onToolStart?: (name: string, taskId?: string) => void;
  onTool?: (name: string, success: boolean, preview?: string, durationMs?: number) => void;
  /**
   * A record the client could not make sense of (unparseable JSON, an event
   * name this version doesn't know). Non-fatal — the stream keeps going — but
   * collected so a half-rendered turn can be explained instead of just looking
   * broken.
   */
  onWarning?: (message: string) => void;
  /**
   * Fired on every byte read from the stream — including events with no
   * dedicated handler (thinking, keepalives). Liveness signal for watchdogs:
   * "connection alive" is not the same as "visible progress".
   */
  onActivity?: () => void;
  /** The connection closed before a `done` frame: whatever arrived is probably incomplete. */
  onTruncated?: () => void;
  onDone: (summary?: StreamSummary) => void;
  /** `detail` is the machine-facing half (status, code) for the error card. */
  onError: (message: string, detail?: string) => void;
}

/**
 * Stream an assistant reply token-by-token over the SSE endpoint
 * `POST /chat/sessions/{id}/messages/stream`. The server emits `event:` names
 * (`thinking`/`chunk`/`tool_start`/`tool_result`/`done`/`error`) with the
 * internally-tagged `ChatStreamEvent` JSON as the data payload, e.g.
 * `{"type":"TextChunk","text":"…"}` — the variant's fields are flat.
 */
/** `\n\n` per the SSE spec, but proxies are known to re-frame as CRLF. */
const RECORD_SEP = /\r?\n\r?\n/;

/**
 * The server's own explanation for a refused stream request, else the status.
 * `detail` carries the status and error code verbatim so the operator can quote
 * something exact when the prose message is generic ("internal error").
 */
async function streamErrorMessage(res: Response): Promise<{ message: string; detail: string }> {
  const fallback = `HTTP ${res.status}`;
  const detail = (code?: string) => `HTTP ${res.status}${code ? ` · ${code}` : ""}`;
  try {
    const text = await res.text();
    if (!text) return { message: fallback, detail: detail() };
    const body = JSON.parse(text) as {
      error?: { message?: string; code?: string };
      message?: string;
      code?: string;
    };
    const code = body.error?.code ?? body.code;
    return {
      message: body.error?.message ?? body.message ?? fallback,
      detail: detail(code),
    };
  } catch {
    // Not JSON: a proxy error page or a plain-text body. The first line of it is
    // usually the only thing that identifies what answered instead of the API.
    return { message: fallback, detail: `${detail()} · non-JSON body` };
  }
}

export async function streamChatMessage(
  sessionId: string,
  text: string,
  h: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    // `null` timeout: a streaming body is read for the life of the stream, so a
    // request deadline would kill it. Mid-stream stalls are the composer's job.
    res = await authedFetch(
      `${API_BASE}/api/v1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: "POST",
        headers: { "content-type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ text }),
        signal,
      },
      null,
    );
  } catch (e) {
    // An intentional abort (unmount / session switch) is not an error.
    if ((e as { name?: string })?.name !== "AbortError") {
      h.onError(e instanceof Error ? e.message : "network error", "request never reached the API");
    }
    return;
  }
  if (!res.ok || !res.body) {
    const { message, detail } = await streamErrorMessage(res);
    h.onError(message, res.body ? detail : `${detail} · empty body`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /** Handle one SSE record. Returns true once a terminal event (done/error) was seen. */
  function handleRecord(record: string): boolean {
    let event = "message";
    const data: string[] = [];
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) return false;
    // ChatStreamEvent is internally tagged (`#[serde(tag = "type")]`), so the
    // variant fields sit flat next to `type`: {"type":"TextChunk","text":"…"},
    // {"type":"Error","message":"…"}. The SSE event name already identifies the
    // variant, so `type` itself is unused here.
    let parsed: {
      /** `chunk` frames, and `thinking` frames that carry a reasoning delta. */
      text?: string;
      message?: string;
      tool_name?: string;
      success?: boolean;
      task_id?: string;
      iteration?: number;
      result_preview?: string;
      duration_ms?: number;
      answer?: string;
      iterations?: number;
      tokens_used?: number;
      cost_usd?: number;
    };
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      h.onWarning?.(`Unreadable ${event} record`);
      return false;
    }
    if (event === "chunk") {
      if (parsed.text) h.onChunk(parsed.text);
    } else if (event === "thinking") {
      h.onThinking?.(parsed.iteration ?? 0, parsed.text);
    } else if (event === "tool_start") {
      h.onToolStart?.(parsed.tool_name ?? "tool", parsed.task_id);
    } else if (event === "tool_result") {
      h.onTool?.(
        parsed.tool_name ?? "tool",
        Boolean(parsed.success),
        parsed.result_preview,
        parsed.duration_ms,
      );
    } else if (event === "done") {
      h.onDone({
        answer: parsed.answer,
        iterations: parsed.iterations,
        tokens: parsed.tokens_used,
        costUsd: parsed.cost_usd,
      });
      return true;
    } else if (event === "error") {
      h.onError(parsed.message ?? "stream error", "stream error frame");
      return true;
    } else {
      // A server newer than this client. Worth surfacing once in the turn's
      // details rather than silently dropping part of the answer.
      h.onWarning?.(`Unknown stream event "${event}"`);
    }
    return false;
  }

  /** Split off every complete record (`\n\n` or CRLF framing, as the SSE spec allows). */
  function drain(): boolean {
    for (;;) {
      const m = RECORD_SEP.exec(buffer);
      if (!m) return false;
      const record = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      if (handleRecord(record)) return true;
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      h.onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      if (drain()) return;
    }
    // Flush the decoder (a trailing partial multi-byte char) and any final
    // record the server did not terminate with a blank line.
    buffer += decoder.decode();
    if (buffer.trim() && handleRecord(buffer)) return;
    // The connection closed without a `done` frame: a proxy cut it, or the
    // kernel died mid-generation. Keep what arrived on screen (the operator can
    // still read it) and say that it is probably incomplete.
    h.onTruncated?.();
    h.onDone();
  } catch (e) {
    // An intentional abort (component unmount / session switch) is not an error.
    if ((e as { name?: string })?.name !== "AbortError") {
      h.onError(e instanceof Error ? e.message : "stream interrupted", "connection dropped mid-stream");
    }
  } finally {
    reader.releaseLock();
  }
}

const EXPORT_TIMEOUT_MS = 5 * 60_000;

/** Download a session export (json|markdown) as a file. */
export async function exportChatSession(sessionId: string, format: "json" | "markdown") {
  // A long transcript can take a while to render server-side — well past the
  // default 30s deadline, which is sized for JSON calls.
  const res = await authedFetch(
    `${API_BASE}/api/v1/chat/sessions/${sessionId}/export?format=${format}`,
    {},
    EXPORT_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-${sessionId.slice(0, 8)}.${format === "markdown" ? "md" : "json"}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function useChatSessions() {
  return useQuery({
    queryKey: chatKeys.sessions,
    queryFn: async () =>
      unwrapList<ChatSessionSummary>(await client.GET("/api/v1/chat/sessions")),
    // Sidebar counts/previews: cheap list, no WS channel — keep it honest.
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}

export function useChatMessages(id: string, streaming = false) {
  return useQuery({
    queryKey: chatKeys.messages(id),
    queryFn: async () =>
      unwrapList<ChatMessage>(
        await client.GET("/api/v1/chat/sessions/{id}/messages", { params: { path: { id } } }),
      ),
    enabled: Boolean(id),
    // No chat channel on the WS yet, so a turn written from another tab or a
    // channel bridge only shows up on reload. Refetch when the tab regains
    // focus (the global default is off) — the streaming path owns its own
    // invalidation. While a reply streams, no refetch at all: the kernel has
    // already persisted the user turn, and a remount/reconnect refetch would
    // render it next to the local echo.
    refetchOnWindowFocus: !streaming,
    refetchOnMount: !streaming,
    refetchOnReconnect: !streaming,
  });
}

export function useCreateChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { agent_name: string; title?: string; first_message?: string }) =>
      unwrap<{ id: string }>(await client.POST("/api/v1/chat/sessions", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.sessions }),
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/chat/sessions/{id}", { params: { path: { id } } }));
    },
    onSuccess: (_res, id) => {
      // The list key is no longer a prefix of the transcript key, so drop the
      // transcript explicitly instead of letting it linger until gcTime.
      qc.removeQueries({ queryKey: chatKeys.messages(id) });
      return qc.invalidateQueries({ queryKey: chatKeys.sessions });
    },
  });
}

export function useRenameChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; title: string }) => {
      unwrap(
        await client.PATCH("/api/v1/chat/sessions/{id}", {
          params: { path: { id: vars.id } },
          body: { title: vars.title },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.sessions }),
  });
}

export function useForkChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap<{ id: string }>(
        await client.POST("/api/v1/chat/sessions/{id}/fork", {
          params: { path: { id } },
          body: {},
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.sessions }),
  });
}
