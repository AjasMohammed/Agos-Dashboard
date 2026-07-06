import { create } from "zustand";

/**
 * Persist the key across reloads only when refresh is explicitly enabled — and
 * only to `sessionStorage`, so the credential is dropped when the tab closes
 * (narrows the exfil window versus `localStorage`).
 */
const PERSIST = import.meta.env.VITE_REFRESH_ENABLED === "true";
const STORAGE_KEY = "agentos-panel.auth";

export interface Session {
  apiKey: string | null;
  keyId: string | null;
  name: string | null;
  scopes: string[];
  expiresAt: string | null;
}

export interface AuthState extends Session {
  /** True once `GET /auth/me` (or login) has populated the session. */
  hydrated: boolean;
  setSession: (s: Partial<Session> & { scopes: string[] }) => void;
  clear: () => void;
  /** Whether the current key grants `resource:op` (e.g. `"agents:r"`). */
  can: (scope: string) => boolean;
}

const empty: Session = { apiKey: null, keyId: null, name: null, scopes: [], expiresAt: null };

function load(): Session {
  if (!PERSIST) return empty;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<Session>) } : empty;
  } catch {
    return empty;
  }
}

function persist(s: Session) {
  if (!PERSIST) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — stay in-memory */
  }
}

/**
 * Mirror of the backend `require_permission` semantics: an empty scope list
 * means full access (bootstrap key); `*` matches any resource; the op string
 * must contain the required op char (`r` ⊆ `rw`).
 */
export function grants(scopes: string[], required: string): boolean {
  if (scopes.length === 0) return true;
  const [reqRes, reqOpRaw] = required.split(":");
  const reqOp = (reqOpRaw ?? "r").charAt(0) || "r";
  return scopes.some((p) => {
    const [res, op = "r"] = p.split(":");
    return (res === reqRes || res === "*") && op.includes(reqOp);
  });
}

const initial = load();

export const useAuthStore = create<AuthState>((set, get) => ({
  ...initial,
  hydrated: false,
  setSession: (s) =>
    set((prev) => {
      const next: Session = {
        apiKey: s.apiKey ?? prev.apiKey,
        keyId: s.keyId ?? prev.keyId,
        name: s.name ?? prev.name,
        scopes: s.scopes,
        expiresAt: s.expiresAt ?? prev.expiresAt,
      };
      persist(next);
      return { ...next, hydrated: true };
    }),
  clear: () => {
    persist(empty);
    set({ ...empty, hydrated: true });
  },
  can: (scope) => grants(get().scopes, scope),
}));

/** Whether a usable key is present (memory or persisted). */
export function isAuthenticated(): boolean {
  return Boolean(useAuthStore.getState().apiKey);
}
