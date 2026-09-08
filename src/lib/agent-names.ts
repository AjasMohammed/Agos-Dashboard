import { useMemo } from "react";
import { useAgents } from "@/api/queries/agents";
import { useAuthStore } from "@/auth/store";

/**
 * Agent id (UUID) → display name, backed by the cached agents list.
 *
 * Many API rows (notifications, activity, audit, secrets, grants, escalations)
 * carry only `agent_id`; operators think in names. Returns `null` while the
 * list is loading or when the id belongs to a removed agent, so callers can
 * fall back to a shortened id.
 */
export function useAgentNames(): (id: string | null | undefined) => string | null {
  // Resolvers mount on pages a key may reach without `agents:r` (dashboard);
  // don't turn every render into a 403.
  const agents = useAgents(useAuthStore((s) => s.can("agents:r")));
  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents.data ?? []) m.set(String(a.id), a.name);
    return m;
  }, [agents.data]);
  return (id) => (id ? (map.get(String(id)) ?? null) : null);
}

/** `agent name` when known, otherwise the first 8 chars of the id. */
export function agentLabel(name: string | null, id: string | null | undefined): string {
  if (name) return name;
  if (!id) return "—";
  const s = String(id);
  // Only UUIDs get shortened; a name-shaped id is already readable.
  return s.length >= 32 ? `${s.slice(0, 8)}…` : s;
}

/** Convenience for components that resolve a single id. */
export function useAgentName(id: string | null | undefined): string {
  const resolve = useAgentNames();
  return agentLabel(resolve(id), id);
}
