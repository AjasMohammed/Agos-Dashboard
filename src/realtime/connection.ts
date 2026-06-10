import { create } from "zustand";
import { useAuthStore } from "@/auth/store";
import type { ClientFrame, ConnectionStatus, ServerFrame } from "./protocol";
import { parseServerFrame } from "./protocol";

// Origin for the WS endpoint (no path); the `/api/v1/ws` route is appended below.
const WS_BASE = import.meta.env.VITE_WS_BASE ?? "";

// Native WebSocket readyState constants (avoid depending on a global in tests).
const OPEN = 1;

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_MS = 20_000;
const WATCHDOG_MS = 45_000;
const MAX_OUTBOX = 100;

/** Connection status surfaced to the topbar indicator. */
export const useRealtimeStatus = create<{ status: ConnectionStatus; retryInSeconds: number }>(
  () => ({ status: "closed", retryInSeconds: 0 }),
);

type FrameListener = (frame: ServerFrame) => void;

const frameListeners = new Set<FrameListener>();
const reconnectListeners = new Set<() => void>();

let socket: WebSocket | null = null;
let outbox: ClientFrame[] = [];
let attempts = 0;
let intentional = false;
let initialized = false;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

/** Allow tests to inject a fake WebSocket implementation. */
let socketFactory: (url: string) => WebSocket = (url) => new WebSocket(url);

function setStatus(status: ConnectionStatus, retryInSeconds = 0) {
  useRealtimeStatus.setState({ status, retryInSeconds });
}

/** Register a listener for every incoming server frame. Returns an unsubscribe fn. */
export function addFrameListener(fn: FrameListener): () => void {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}

/** Register a callback fired after each successful (re)connection — used to re-subscribe. */
export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

/** Send a frame, queueing it (bounded) until the socket is open. */
export function sendFrame(frame: ClientFrame): void {
  if (socket && socket.readyState === OPEN) {
    socket.send(JSON.stringify(frame));
  } else {
    if (outbox.length >= MAX_OUTBOX) outbox.shift();
    outbox.push(frame);
  }
}

function clearTimers() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (watchdogTimer) clearTimeout(watchdogTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  reconnectTimer = watchdogTimer = heartbeatTimer = countdownTimer = null;
}

function armWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    // No traffic for WATCHDOG_MS — assume a dead socket and force a reconnect.
    if (socket) socket.close();
  }, WATCHDOG_MS);
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => sendFrame({ type: "ping" }), HEARTBEAT_MS);
  armWatchdog();
}

function backoffMs(): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempts);
  const jitter = exp * 0.2 * (Math.random() - 0.5) * 2; // ±20%
  return Math.max(BASE_BACKOFF_MS, Math.round(exp + jitter));
}

function scheduleReconnect() {
  // Never stack reconnect timers — clear any pending one first (a synchronous
  // open() failure could otherwise orphan the previous timer and spawn parallel sockets).
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  const delay = backoffMs();
  attempts += 1;
  setStatus("reconnecting", Math.ceil(delay / 1000));
  countdownTimer = setInterval(() => {
    const next = Math.max(0, useRealtimeStatus.getState().retryInSeconds - 1);
    useRealtimeStatus.setState({ retryInSeconds: next });
  }, 1_000);
  reconnectTimer = setTimeout(() => {
    if (countdownTimer) clearInterval(countdownTimer);
    open();
  }, delay);
}

function open() {
  // Guard against opening a second socket (e.g. a reconnect timer firing while
  // a connection already came up).
  if (socket) return;
  const key = useAuthStore.getState().apiKey;
  if (!key) {
    setStatus("closed");
    return;
  }
  intentional = false;
  setStatus(attempts === 0 ? "connecting" : "reconnecting");
  const url = `${WS_BASE}/api/v1/ws?token=${encodeURIComponent(key)}`;
  let ws: WebSocket;
  try {
    ws = socketFactory(url);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempts = 0;
    setStatus("open");
    const queued = outbox;
    outbox = [];
    for (const frame of queued) sendFrame(frame);
    startHeartbeat();
    reconnectListeners.forEach((fn) => fn());
  };

  ws.onmessage = (ev: MessageEvent) => {
    armWatchdog();
    const frame = parseServerFrame(typeof ev.data === "string" ? ev.data : String(ev.data));
    if (!frame) return;
    // A malformed frame (or a buggy listener) must not throw out of onmessage.
    for (const fn of frameListeners) {
      try {
        fn(frame);
      } catch (err) {
        console.error("realtime frame listener error", err);
      }
    }
  };

  ws.onerror = () => {
    /* surfaced via onclose */
  };

  ws.onclose = () => {
    socket = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watchdogTimer) clearTimeout(watchdogTimer);
    heartbeatTimer = watchdogTimer = null;
    if (intentional || !useAuthStore.getState().apiKey) {
      setStatus("closed");
    } else {
      scheduleReconnect();
    }
  };
}

/** Open the realtime connection (no-op without a key). */
export function connectRealtime(): void {
  if (socket || !useAuthStore.getState().apiKey) return;
  attempts = 0;
  open();
}

/** Tear down the connection and stop reconnecting (e.g. on logout). */
export function disconnectRealtime(): void {
  intentional = true;
  clearTimers();
  attempts = 0;
  outbox = [];
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  setStatus("closed");
}

/**
 * Wire the connection lifecycle to auth: connect when a key appears, disconnect
 * when it is cleared. Call once at app startup. Idempotent.
 */
export function initRealtime(): void {
  if (initialized) return;
  initialized = true;
  if (useAuthStore.getState().apiKey) connectRealtime();
  useAuthStore.subscribe((state, prev) => {
    if (state.apiKey && !prev.apiKey) connectRealtime();
    else if (!state.apiKey && prev.apiKey) disconnectRealtime();
  });
}

/** Test-only hooks. */
export const __test = {
  setSocketFactory(factory: (url: string) => WebSocket) {
    socketFactory = factory;
  },
  reset() {
    clearTimers();
    if (socket) {
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    socket = null;
    outbox = [];
    attempts = 0;
    intentional = false;
    initialized = false;
    frameListeners.clear();
    reconnectListeners.clear();
    setStatus("closed");
  },
  get outboxSize() {
    return outbox.length;
  },
};
