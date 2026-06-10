/**
 * WebSocket wire protocol — hand-mirrored from the Rust `ClientFrame` /
 * `ServerFrame` enums in `crates/agentos-api/src/ws/protocol.rs`. Both are
 * `#[serde(tag = "type")]`, so every frame is `{ type, ...fields }`.
 *
 * (There is no codegen for these — the backend has no `gen-events` bin — so this
 * file is the source of truth on the client. Keep it in sync with the Rust enum.)
 */

// ── Client → Server ─────────────────────────────────────────────────────────

export type ClientFrame =
  | { type: "subscribe"; channel: string; filter?: unknown }
  | { type: "unsubscribe"; subscription_id: string }
  | { type: "chat.send"; session_id: string; message: string; agent_name?: string }
  | { type: "notification.respond"; id: string; text: string }
  | { type: "chat.cancel"; session_id: string }
  | { type: "task.cancel"; task_id: string }
  | { type: "ping" };

// ── Server → Client ─────────────────────────────────────────────────────────

export interface EventFrame {
  type: "event";
  channel: string;
  event: string;
  data: unknown;
}

export type ServerFrame =
  | { type: "subscribed"; channel: string; subscription_id: string }
  | { type: "unsubscribed"; subscription_id: string }
  | EventFrame
  | { type: "chat.chunk"; session_id: string; delta: string }
  | { type: "chat.done"; session_id: string; tool_calls: unknown[] }
  | { type: "chat.cancelled"; session_id: string }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

/** Connection lifecycle states surfaced to the UI. */
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

/**
 * Mirror of the backend `channel_matches`: an event on `eventChannel` is
 * delivered to a subscription on `subscribed` when they are equal or when the
 * event is a parameterized child (`"tasks"` matches `"tasks:abc"`).
 */
export function channelMatches(subscribed: string, eventChannel: string): boolean {
  if (subscribed === eventChannel) return true;
  return eventChannel.startsWith(`${subscribed}:`);
}

/** Best-effort parse of an incoming WS text frame into a typed ServerFrame. */
export function parseServerFrame(raw: string): ServerFrame | null {
  try {
    const value = JSON.parse(raw) as { type?: unknown };
    return typeof value?.type === "string" ? (value as ServerFrame) : null;
  } catch {
    return null;
  }
}
