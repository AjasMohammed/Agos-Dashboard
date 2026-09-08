import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared ease-out curve for the few entrances that still animate (chat rail). */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Per-route entrance: a 120ms fade, CSS only. Motion in this panel is limited
 * to state changes that need it (menus opening, live dots); page content just
 * appears.
 */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("animate-fade-in", className)}>{children}</div>;
}
