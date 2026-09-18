import type { StreamPart } from "./stream-store";

/**
 * What a turn actually looked like, per assistant row.
 *
 * The transcript cannot express a turn: `ApiChatMessage` has no field for
 * reasoning, the reply is one flat string, and tool calls come back as separate
 * rows. Rendering from it regroups every turn into "all the thinking, then the
 * tools, then the text" — which is not the sequence that happened, and is the
 * regrouping this codebase already refuses to do while streaming. So the panel
 * keeps the ordered parts itself, keyed by the assistant row's timestamp (the
 * only stable id the transcript has), and replays them after the handover.
 *
 * ponytail: localStorage, per session, newest turns only, and only turns that
 * have something the transcript can't hold (a thought or a tool call) — a plain
 * text reply renders identically from `m.content`. Delete this whole file the
 * day the kernel persists turn structure.
 */
const PREFIX = "agentos-panel:chat-turn:";
const KEY = (sessionId: string) => PREFIX + sessionId;

/** Turns kept per session; older ones are dropped rather than growing forever. */
const LIMIT = 50;

/** assistant row timestamp -> that turn's parts, in arrival order */
export type TurnLog = Record<string, StreamPart[]>;

function isPart(p: unknown): p is StreamPart {
  const v = p as StreamPart;
  if (!v || typeof v !== "object") return false;
  if (v.kind === "text") return typeof v.text === "string";
  if (v.kind === "thinking") return typeof v.iteration === "number";
  return v.kind === "tool" && typeof v.name === "string";
}

/**
 * Anything could be under our key — a truncated write, a build with a different
 * shape, a browser extension. The transcript renders whatever comes back, so a
 * bad value would throw inside the render and take the conversation down
 * through the error boundary — on every reload, with nothing in the UI able to
 * clear the key. Validate at the boundary.
 */
function parseLog(raw: string | null): TurnLog {
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  if (!parsed || typeof parsed !== "object") return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(
      (e): e is [string, StreamPart[]] => Array.isArray(e[1]) && e[1].every(isPart),
    ),
  );
}

/** Storage is unavailable in private mode and throws on quota — never fatal. */
export function readTurnLog(sessionId: string): TurnLog {
  try {
    return parseLog(localStorage.getItem(KEY(sessionId)));
  } catch {
    return {};
  }
}

/**
 * Write, shrinking on quota rather than wedging. Turns carry unbounded prose
 * (reasoning, tool previews), so `LIMIT` of them can still blow the origin's
 * quota — and a throw here would fail EVERY later write for this session (the
 * trim never shrinks what is already stored) and starve the other guarded
 * writers on this origin (theme, nav groups, rail state) too.
 */
function persist(sessionId: string, log: TurnLog): TurnLog {
  const keys = Object.keys(log).sort();
  for (const keep of [LIMIT, 5, 1]) {
    const next = Object.fromEntries(keys.slice(-keep).map((k) => [k, log[k]]));
    try {
      localStorage.setItem(KEY(sessionId), JSON.stringify(next));
      return next;
    } catch {
      /* too big (or blocked): try again with fewer turns */
    }
  }
  clearTurnLog(sessionId);
  return log;
}

/** Record one turn's parts against the assistant row that carries its reply. */
export function saveTurn(sessionId: string, timestamp: string, parts: StreamPart[]): TurnLog {
  // Insertion order is arrival order, but a reload replays JSON key order, so
  // `persist` trims by the timestamps themselves.
  return persist(sessionId, { ...readTurnLog(sessionId), [timestamp]: parts });
}

/** Session deleted — its turns have nothing left to hang on. */
export function clearTurnLog(sessionId: string) {
  try {
    localStorage.removeItem(KEY(sessionId));
  } catch {
    /* nothing to do */
  }
}
