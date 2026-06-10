import type { ReactNode } from "react";
import { useAuthStore } from "./store";

/**
 * Render `children` only when the current key grants `scope`. Use to gate UI
 * affordances (buttons, menu items) — not as a security boundary (the server
 * enforces scopes; this just avoids showing actions that would 403).
 */
export function ScopeGuard({
  scope,
  children,
  fallback = null,
}: {
  scope: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const can = useAuthStore((s) => s.can(scope));
  return <>{can ? children : fallback}</>;
}
