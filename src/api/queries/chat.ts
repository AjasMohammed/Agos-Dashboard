import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap, unwrapList, authedFetch } from "../client";
import type { ChatSessionSummary, ChatMessage } from "../models";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export const chatKeys = {
  sessions: ["chat", "sessions"] as const,
  messages: (id: string) => ["chat", "sessions", id, "messages"] as const,
};

export interface StreamHandlers {
  onChunk: (text: string) => void;
  onToolStart?: (name: string) => void;
  onTool?: (name: string, success: boolean) => void;
  /**
   * Fired on every byte read from the stream — including events with no
   * dedicated handler (thinking, keepalives). Liveness signal for watchdogs:
   * "connection alive" is not the same as "visible progress".
   */
  onActivity?: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Stream an assistant reply token-by-token over the SSE endpoint
 * `POST /chat/sessions/{id}/messages/stream`. The server emits `event:` names
 * (`thinking`/`chunk`/`tool_start`/`tool_result`/`done`/`error`) with the
 * internally-tagged `ChatStreamEvent` JSON as the data payload, e.g.
 * `{"type":"TextChunk","text":"…"}` — the variant's fields are flat.
 */
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
      h.onError(e instanceof Error ? e.message : "network error");
    }
    return;
  }
  if (!res.ok || !res.body) {
    h.onError(`HTTP ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      h.onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const record = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of record.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length === 0) continue;
        // ChatStreamEvent is internally tagged (`#[serde(tag = "type")]`), so the
        // variant fields sit flat next to `type`: {"type":"TextChunk","text":"…"},
        // {"type":"Error","message":"…"}. The SSE event name already identifies the
        // variant, so `type` itself is unused here.
        let parsed: { text?: string; message?: string; tool_name?: string; success?: boolean };
        try {
          parsed = JSON.parse(data.join("\n"));
        } catch {
          continue;
        }
        if (event === "chunk") {
          if (parsed.text) h.onChunk(parsed.text);
        } else if (event === "tool_start") {
          h.onToolStart?.(parsed.tool_name ?? "tool");
        } else if (event === "tool_result") {
          h.onTool?.(parsed.tool_name ?? "tool", Boolean(parsed.success));
        } else if (event === "done") {
          h.onDone();
          return;
        } else if (event === "error") {
          h.onError(parsed.message ?? "stream error");
          return;
        }
      }
    }
    h.onDone();
  } catch (e) {
    // An intentional abort (component unmount / session switch) is not an error.
    if ((e as { name?: string })?.name !== "AbortError") {
      h.onError(e instanceof Error ? e.message : "stream interrupted");
    }
  } finally {
    reader.releaseLock();
  }
}

/** Download a session export (json|markdown) as a file. */
export async function exportChatSession(sessionId: string, format: "json" | "markdown") {
  const res = await authedFetch(
    `${API_BASE}/api/v1/chat/sessions/${sessionId}/export?format=${format}`,
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
  });
}

export function useChatMessages(id: string) {
  return useQuery({
    queryKey: chatKeys.messages(id),
    queryFn: async () =>
      unwrapList<ChatMessage>(
        await client.GET("/api/v1/chat/sessions/{id}/messages", { params: { path: { id } } }),
      ),
    enabled: Boolean(id),
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

export function useSendChatMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) =>
      unwrap<ChatMessage>(
        await client.POST("/api/v1/chat/sessions/{id}/messages", {
          params: { path: { id } },
          body: { text },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.messages(id) }),
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/chat/sessions/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.sessions }),
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
