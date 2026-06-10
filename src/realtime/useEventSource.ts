import { useEffect, useRef } from "react";
import { useAuthStore } from "@/auth/store";

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

// Origin only — callers pass full `/api/v1/...` paths (which carry the prefix).
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

/** Parse one SSE record (`event:`/`data:`/`id:` lines) into a typed event. */
function parseRecord(block: string): SseEvent | null {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  return data.length ? { event, data: data.join("\n"), id } : null;
}

/**
 * Consume a `text/event-stream` endpoint. Unlike the native `EventSource`, this
 * is `fetch`-based so it can send the `Authorization: Bearer` header (the API's
 * SSE routes are Bearer-protected). Resumes with `Last-Event-ID`, auto-retries
 * with a small backoff, and closes on any `terminalEvents`.
 */
export function useEventSource(
  url: string | null | undefined,
  onEvent: (event: SseEvent) => void,
  options: { terminalEvents?: string[] } = {},
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const terminal = options.terminalEvents;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let stopped = false;
    let lastEventId: string | undefined;

    async function streamOnce(): Promise<boolean> {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      const key = useAuthStore.getState().apiKey;
      if (key) headers.Authorization = `Bearer ${key}`;
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;
      const full = url!.startsWith("http") ? url! : `${API_BASE}${url}`;

      const res = await fetch(full, { headers, signal: controller.signal });
      if (!res.ok || !res.body) return false;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return true;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const record = parseRecord(buffer.slice(0, sep));
          buffer = buffer.slice(sep + 2);
          if (!record) continue;
          if (record.id) lastEventId = record.id;
          handlerRef.current(record);
          if (terminal?.includes(record.event)) {
            stopped = true;
            controller.abort();
            return true;
          }
        }
      }
    }

    async function loop() {
      let backoff = RETRY_MS;
      while (!stopped) {
        // Stop retrying once logged out — don't flood a dead/unauthorized endpoint.
        if (!useAuthStore.getState().apiKey) return;
        let ok = false;
        try {
          ok = await streamOnce();
        } catch {
          if (stopped) return; // aborted on unmount / terminal event
        }
        if (stopped) return;
        // Reset backoff after a clean stream; grow it (capped) on failures so a
        // permanently-failing endpoint doesn't reconnect every RETRY_MS forever.
        backoff = ok ? RETRY_MS : Math.min(backoff * 2, MAX_RETRY_MS);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    void loop();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [url, terminal]);
}
