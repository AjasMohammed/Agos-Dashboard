import { useEffect, useRef, useState } from "react";
import { CatchBoundary, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  Moon,
  Sun,
  Monitor,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";
import { MORE_NAV, PRIMARY_NAV, type NavItem } from "./nav";
import { useTheme, type Theme } from "./theme";
import { AppErrorBoundary } from "./app-error-boundary";
import { useAuthStore } from "@/auth/store";
import { ScopeGuard } from "@/auth/scope-guard";
import { logout } from "@/auth/actions";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeStatus } from "@/realtime/connection";
import { useUnreadCount, notificationKeys } from "@/api/queries/notifications";
import { useEscalations } from "@/api/queries/governance";
import { useChannel } from "@/realtime/useChannel";
import { Button } from "@/components/ui/button";
import { EASE_OUT, PageTransition } from "@/components/motion";
import { cn } from "@/lib/utils";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const order: Theme[] = ["light", "dark", "system"];
  const next = order[(order.indexOf(theme) + 1) % order.length];
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <Button variant="ghost" size="icon" title={`Theme: ${theme}`} onClick={() => setTheme(next)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -30, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 30, scale: 0.8 }}
          transition={{ duration: 0.15 }}
          className="flex"
        >
          <Icon />
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}

const MORE_KEY = "agentos-panel:nav-more";
const COLLAPSED_KEY = "agentos-panel:nav-collapsed";
/** Tailwind's `md` breakpoint — below it the expanded sidebar becomes a drawer. */
const NARROW_QUERY = "(max-width: 767px)";

function readStoredFlag(key: string): boolean | null {
  try {
    const stored = localStorage.getItem(key);
    return stored === "1" ? true : stored === "0" ? false : null;
  } catch {
    return null; // storage unavailable — fall back to the computed default
  }
}

function writeStoredFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // storage unavailable — in-memory state still works
  }
}

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(NARROW_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq) return;
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

// `pathname` is passed in rather than read here: this renders up to 32 times,
// and each `useRouterState` is its own router subscription.
function NavLink({
  item,
  collapsed,
  pathname,
  badge = 0,
}: {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
  /** Pending-count pill (approval queue). */
  badge?: number;
}) {
  const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
  const Icon = item.icon;
  return (
    <li>
      <Link
        to={item.to}
        title={item.label}
        aria-label={badge > 0 ? `${item.label}, ${badge} pending` : undefined}
        className={cn(
          "relative flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
          active
            ? "text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          collapsed && "justify-center",
        )}
      >
        {active && (
          <motion.span
            layoutId="nav-active"
            className="absolute inset-0 rounded-md bg-accent shadow-card"
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
          />
        )}
        <Icon className={cn("relative z-10 size-4 shrink-0", active && "text-primary")} />
        {!collapsed && <span className="relative z-10 flex-1 truncate">{item.label}</span>}
        {badge > 0 && (
          <span
            aria-hidden
            className={cn(
              "z-10 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground",
              collapsed ? "absolute -right-0.5 -top-0.5" : "relative",
            )}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Primary items on top; every other route folds under "More" so the sidebar
 * reads as a product, not a kernel subsystem list. Nothing is unreachable.
 */
function Sidebar({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  const can = useAuthStore((s) => s.can);
  const [moreOpen, setMoreOpen] = useState(() => readStoredFlag(MORE_KEY) ?? false);
  function toggleMore() {
    // Persist outside the state updater — React may invoke an updater twice
    // (StrictMode, concurrent re-render), so it must stay side-effect free.
    const next = !moreOpen;
    setMoreOpen(next);
    writeStoredFlag(MORE_KEY, next);
  }
  const visible = (items: NavItem[]) => items.filter((i) => !i.scope || can(i.scope));
  const primary = visible(PRIMARY_NAV);
  const more = MORE_NAV.map((g) => ({ ...g, items: visible(g.items) })).filter(
    (g) => g.items.length > 0,
  );
  // Same 30s cadence as the notification bell; the queue page itself polls
  // faster and shares this cache entry, so nothing is fetched twice.
  const escalations = useEscalations({ enabled: can("escalations:r"), refetchInterval: 30_000 });
  const pending = (escalations.data ?? []).filter((e) => !e.resolved).length;
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 overflow-y-auto overflow-x-hidden p-3">
      <ul className="space-y-0.5">
        {primary.map((item) => (
          <NavLink
            key={item.to}
            item={item}
            collapsed={collapsed}
            pathname={pathname}
            badge={item.to === "/escalations" ? pending : 0}
          />
        ))}
      </ul>
      {more.length > 0 && (
        <div>
          <button
            type="button"
            onClick={toggleMore}
            aria-expanded={moreOpen}
            title="More"
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
              collapsed && "justify-center",
            )}
          >
            <MoreHorizontal className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">More</span>
                <ChevronDown
                  className={cn("size-4 transition-transform", moreOpen && "rotate-180")}
                />
              </>
            )}
          </button>
          {moreOpen &&
            more.map((group) => (
              <div key={group.label} className="mt-3">
                {!collapsed && (
                  <p className="px-2 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                    {group.label}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </nav>
  );
}

const STATUS_LABEL: Record<
  string,
  { color: string; pulse: boolean; label: (s: number) => string }
> = {
  open: { color: "bg-success", pulse: false, label: () => "Live" },
  connecting: { color: "bg-warning", pulse: true, label: () => "Connecting…" },
  reconnecting: {
    color: "bg-warning",
    pulse: true,
    label: (s) => (s > 0 ? `Reconnecting in ${s}s` : "Reconnecting…"),
  },
  closed: { color: "bg-muted-foreground", pulse: false, label: () => "Offline" },
};

function ConnectionIndicator() {
  const { status, retryInSeconds } = useRealtimeStatus();
  const meta = STATUS_LABEL[status] ?? STATUS_LABEL.closed;
  return (
    <span
      className="flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
      title={`Realtime: ${status}`}
    >
      <span className="relative flex size-2">
        {meta.pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
              meta.color,
            )}
          />
        )}
        {status === "open" && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-success/40 blur-[2px]" />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", meta.color)} />
      </span>
      {meta.label(retryInSeconds)}
    </span>
  );
}

function NotificationBell() {
  // Server-backed unread count (30s poll) so the badge is correct on load;
  // WS notification events refresh it immediately.
  const unreadQuery = useUnreadCount();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const unread = unreadQuery.data?.unread_count ?? 0;
  useChannel("notifications", () => qc.invalidateQueries({ queryKey: notificationKeys.unread }));
  return (
    <Button
      variant="ghost"
      size="icon"
      title="Notifications"
      aria-label={`Notifications, ${unread} unread`}
      className="relative"
      // Section routes are registered dynamically from NAV, so the router's
      // static type union doesn't know them — same string-widening as nav links.
      onClick={() => void navigate({ to: "/notifications" as string })}
    >
      <Bell />
      <AnimatePresence>
        {unread > 0 && (
          <motion.span
            key={unread}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
          >
            {unread > 9 ? "9+" : unread}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}

function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const name = useAuthStore((s) => s.name);
  const scopes = useAuthStore((s) => s.scopes);
  return (
    <header className="glass z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      <Button variant="ghost" size="icon" onClick={onToggleSidebar} title="Toggle sidebar">
        <PanelLeft />
      </Button>
      <div className="ml-auto flex items-center gap-1.5">
        <ConnectionIndicator />
        {/* Without the scope the bell would poll into a 403 and its click would
            bounce off the route's own scopeGuard — hide it like the nav item. */}
        <ScopeGuard scope="notifications:r">
          <NotificationBell />
        </ScopeGuard>
        <ThemeToggle />
        <div className="mx-1 hidden text-right sm:block">
          <p className="text-xs font-medium leading-tight">{name ?? "operator"}</p>
          <p className="font-mono text-[10px] leading-tight text-muted-foreground">
            {scopes.length === 0
              ? "full access"
              : scopes.length === 1
                ? scopes[0]
                : `${scopes.length} scopes`}
          </p>
        </div>
        <Button variant="ghost" size="icon" title="Log out" onClick={logout}>
          <LogOut />
        </Button>
      </div>
    </header>
  );
}

function DisconnectedBanner() {
  const status = useRealtimeStatus((s) => s.status);
  return (
    <AnimatePresence initial={false}>
      {/* Only flag a genuine drop (reconnecting) — not the brief initial connect. */}
      {status === "reconnecting" && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="overflow-hidden bg-warning/15"
          // Announced, not just coloured: without this a screen-reader operator
          // gets no signal that the data on screen went stale.
          role="status"
        >
          <p className="px-4 py-1 text-center text-xs text-warning">
            Realtime disconnected — showing last known data while reconnecting.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AppShell() {
  const narrow = useIsNarrow();
  const reduced = useReducedMotion();
  // No stored preference → collapse on phones, where 240px is most of the screen.
  const [collapsed, setCollapsed] = useState(
    () =>
      readStoredFlag(COLLAPSED_KEY) ?? (typeof window !== "undefined" && window.innerWidth < 768),
  );
  const navigate = useNavigate();
  const apiKey = useAuthStore((s) => s.apiKey);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mainRef = useRef<HTMLElement>(null);
  // Below `md` the expanded sidebar floats over the page instead of eating its width.
  const overlay = narrow && !collapsed;

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    writeStoredFlag(COLLAPSED_KEY, next);
  }

  // If the session is cleared while on a protected page (e.g. a background 401),
  // redirect to login instead of leaving the user on a now-broken page. Keep the
  // pathname so signing back in returns here rather than dumping them on home.
  useEffect(() => {
    if (!apiKey) navigate({ to: "/login", search: { redirect: window.location.pathname } });
  }, [apiKey, navigate]);

  // <main> is the scroll container and is never remounted, so without this the
  // next page opens at the previous page's scroll offset.
  useEffect(() => {
    // `?.scrollTo?.` — jsdom (unit tests) has no Element.scrollTo.
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  // Tapping a nav link in the drawer should close it.
  useEffect(() => {
    if (narrow) setCollapsed(true);
  }, [pathname, narrow]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* 32 nav links precede the page content — WCAG 2.4.1. */}
      <a
        href="#main"
        className="sr-only rounded-md border border-border bg-card px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>
      {overlay && (
        <div
          aria-hidden
          onClick={() => setCollapsed(true)}
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm"
        />
      )}
      <motion.aside
        animate={{ width: collapsed ? 64 : 240 }}
        // Width is a layout property, so this reflows the page every frame;
        // honour the OS "reduce motion" setting (MotionConfig's reducedMotion
        // does not cover a raw width animation).
        transition={reduced ? { duration: 0 } : { duration: 0.25, ease: EASE_OUT }}
        className={cn(
          "flex shrink-0 flex-col overflow-hidden border-r border-border bg-card/40",
          overlay && "fixed inset-y-0 left-0 z-40 shadow-lg",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center gap-2 border-b border-border",
            collapsed ? "justify-center px-2" : "px-4",
          )}
        >
          {!collapsed && (
            <>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-glow">
                <span className="font-mono text-sm font-bold">A</span>
              </div>
              <span className="font-semibold tracking-tight">AgentOS</span>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(!collapsed && "ml-auto")}
            onClick={toggleCollapsed}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <PanelLeft /> : <PanelLeftClose />}
          </Button>
        </div>
        <Sidebar collapsed={collapsed} pathname={pathname} />
      </motion.aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onToggleSidebar={toggleCollapsed} />
        <DisconnectedBanner />
        {/* Chat owns the whole viewport (its own scroll region + pinned
            composer); every other page scrolls inside the padded main. */}
        <main
          id="main"
          tabIndex={-1}
          ref={mainRef}
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            pathname === "/" ? "overflow-hidden" : "overflow-y-auto px-6",
          )}
        >
          <PageTransition
            key={pathname}
            className={pathname === "/" ? "flex min-h-0 flex-1 flex-col" : undefined}
          >
            {/* Inside <main>, so a page throw keeps the sidebar, topbar and
                connection indicator; the key clears it on the next navigation. */}
            <CatchBoundary getResetKey={() => pathname} errorComponent={AppErrorBoundary}>
              <Outlet />
            </CatchBoundary>
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
