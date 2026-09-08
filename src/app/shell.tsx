import { useEffect, useRef, useState } from "react";
import { CatchBoundary, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, ChevronRight, LogOut, Monitor, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { NAV, NAV_ITEMS, isNavActive, type NavGroup, type NavItem } from "./nav";
import { useTheme, type Theme } from "./theme";
import { AppErrorBoundary } from "./app-error-boundary";
import { grants, useAuthStore } from "@/auth/store";
import { ScopeGuard } from "@/auth/scope-guard";
import { logout } from "@/auth/actions";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeStatus } from "@/realtime/connection";
import { useUnreadCount, notificationKeys } from "@/api/queries/notifications";
import { useEscalations, escalationKeys } from "@/api/queries/governance";
import { useInvalidateOnEvent } from "@/realtime/cacheBridge";
import { useChannel } from "@/realtime/useChannel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageTransition } from "@/components/motion";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "agentos-panel:nav-collapsed";
const GROUP_KEY = "agentos-panel:nav-group:";

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

function CountPill({ count, className }: { count: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "tnum flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// `pathname` is passed in rather than read here: this renders ~35 times, and
// each `useRouterState` is its own router subscription.
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
  const active = isNavActive(item, pathname);
  const Icon = item.icon;
  return (
    <li>
      <Link
        to={item.to}
        title={collapsed ? item.label : undefined}
        aria-label={badge > 0 ? `${item.label}, ${badge} pending` : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-8 items-center gap-2.5 rounded-md text-sm font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          collapsed ? "justify-center" : "px-2",
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
          )}
        />
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {badge > 0 && <CountPill count={badge} className={cn(collapsed && "absolute right-0.5 top-0.5")} />}
      </Link>
    </li>
  );
}

/**
 * A foldable sidebar section. Opens itself when the current page lives inside
 * it (so a deep link never lands on a hidden item); the operator's own toggle
 * is remembered per group.
 */
function NavSection({
  group,
  collapsed,
  pathname,
  badgeFor,
}: {
  group: NavGroup;
  collapsed: boolean;
  pathname: string;
  badgeFor: (item: NavItem) => number;
}) {
  const containsActive = group.items.some((i) => isNavActive(i, pathname));
  const [open, setOpen] = useState(() => readStoredFlag(GROUP_KEY + group.label) ?? containsActive);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  function toggle() {
    // Persist outside the state updater — React may invoke an updater twice
    // (StrictMode, concurrent re-render), so it must stay side-effect free.
    const next = !open;
    setOpen(next);
    writeStoredFlag(GROUP_KEY + group.label, next);
  }
  const hidden = group.items.reduce((n, i) => n + badgeFor(i), 0);

  if (collapsed) {
    return (
      <li className="border-t border-border pt-2 first:border-0 first:pt-0">
        <ul className="space-y-0.5">
          {group.items.map((item) => (
            <NavLink key={item.to} item={item} collapsed pathname={pathname} badge={badgeFor(item)} />
          ))}
        </ul>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
        />
        <span className="flex-1 text-left">{group.label}</span>
        {!open && hidden > 0 && <CountPill count={hidden} />}
      </button>
      {open && (
        <ul className="mt-0.5 space-y-0.5">
          {group.items.map((item) => (
            <NavLink key={item.to} item={item} collapsed={false} pathname={pathname} badge={badgeFor(item)} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Sidebar({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  // Subscribe to `scopes`, not the stable `can` function: the sidebar must
  // re-render when `/auth/me` fills the scopes in after first paint.
  const scopes = useAuthStore((s) => s.scopes);
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.scope || grants(scopes, i.scope)),
  })).filter((g) => g.items.length > 0);
  const workspace = groups.find((g) => g.label === NAV[0].label);
  const sections = groups.filter((g) => g !== workspace);
  // The kernel pushes escalation.created/resolved/expired, so the badge counts
  // a new approval the moment it exists. The 30s poll is only the fallback for a
  // dropped socket — it used to be the sole path, which is why the badge could
  // sit at zero for half a minute after the operator's phone had already buzzed.
  // (`pending:true` is its own cache entry; `escalationKeys.all` is a prefix of
  // it, so a prefix invalidation covers both this and the queue page.)
  useInvalidateOnEvent(
    grants(scopes, "escalations:r") ? "escalations" : null,
    [escalationKeys.all],
    // The sweeper can expire a whole backlog in one tick; without this each
    // event cancels the refetch the previous one started.
    { debounceMs: 300 },
  );
  const escalations = useEscalations({
    enabled: grants(scopes, "escalations:r"),
    refetchInterval: 30_000,
    pending: true,
  });
  const pending = (escalations.data ?? []).filter((e) => !e.resolved).length;
  const badgeFor = (item: NavItem) => (item.to === "/escalations" ? pending : 0);
  return (
    <nav
      aria-label="Main"
      className={cn("flex flex-1 flex-col overflow-y-auto overflow-x-hidden py-2", collapsed ? "px-1.5" : "px-2")}
    >
      {workspace && (
        <ul className="space-y-0.5">
          {workspace.items.map((item) => (
            <NavLink key={item.to} item={item} collapsed={collapsed} pathname={pathname} badge={badgeFor(item)} />
          ))}
        </ul>
      )}
      {sections.length > 0 && (
        <ul className={cn("mt-2 space-y-1 border-t border-border pt-2", collapsed && "space-y-2")}>
          {sections.map((group) => (
            <NavSection
              key={group.label}
              group={group}
              collapsed={collapsed}
              pathname={pathname}
              badgeFor={badgeFor}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}

const STATUS: Record<string, { dot: string; pulse: boolean; label: (s: number) => string }> = {
  open: { dot: "bg-success", pulse: false, label: () => "Live" },
  connecting: { dot: "bg-warning", pulse: true, label: () => "Connecting…" },
  reconnecting: {
    dot: "bg-warning",
    pulse: true,
    label: (s) => (s > 0 ? `Reconnecting in ${s}s` : "Reconnecting…"),
  },
  closed: { dot: "bg-muted-foreground", pulse: false, label: () => "Offline" },
};

function ConnectionIndicator() {
  const { status, retryInSeconds } = useRealtimeStatus();
  const meta = STATUS[status] ?? STATUS.closed;
  return (
    <span
      className="hidden h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground sm:flex"
      title={`Realtime connection: ${status}`}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", meta.dot, meta.pulse && "animate-pulse")}
      />
      {meta.label(retryInSeconds)}
    </span>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const order: Theme[] = ["light", "dark", "system"];
  const next = order[(order.indexOf(theme) + 1) % order.length];
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      title={`Theme: ${theme}`}
      aria-label={`Theme: ${theme}. Switch to ${next}`}
      className="text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(next)}
    >
      <Icon />
    </Button>
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
      className="relative text-muted-foreground hover:text-foreground"
      // Section routes are registered dynamically from NAV, so the router's
      // static type union doesn't know them — same string-widening as nav links.
      onClick={() => void navigate({ to: "/notifications" as string })}
    >
      <Bell />
      {unread > 0 && <CountPill count={unread} className="absolute right-0.5 top-0.5" />}
    </Button>
  );
}

function UserMenu() {
  const name = useAuthStore((s) => s.name);
  const scopes = useAuthStore((s) => s.scopes);
  const initial = (name ?? "operator").slice(0, 1).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Account: ${name ?? "operator"}`}
          title={name ?? "operator"}
          className="ml-0.5"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-foreground">{name ?? "operator"}</DropdownMenuLabel>
        <div className="px-2 pb-1.5 text-xs text-muted-foreground">
          {scopes.length === 0 ? (
            "No scopes granted"
          ) : (
            <span className="break-all font-mono">{scopes.join("  ")}</span>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} destructive>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Topbar({ onToggleSidebar, pathname }: { onToggleSidebar: () => void; pathname: string }) {
  const current = NAV_ITEMS.find((item) => isNavActive(item, pathname));
  const group = current && NAV.find((g) => g.items.includes(current))?.label;
  const openPalette = () => window.dispatchEvent(new Event("agentos:command-palette"));
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-2 sm:px-3">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
        className="text-muted-foreground hover:text-foreground"
      >
        <PanelLeft />
      </Button>
      <nav aria-label="Breadcrumb" className="ml-1 hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
        {group && (
          <>
            <span className="text-muted-foreground">{group}</span>
            <span aria-hidden className="text-muted-foreground/50">
              /
            </span>
          </>
        )}
        <span className="truncate font-medium">{current?.label ?? "AgentOS"}</span>
      </nav>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={openPalette}
          className="mr-1 hidden h-8 w-56 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
        >
          <Search aria-hidden className="size-4" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={openPalette}
          aria-label="Search"
          title="Search (⌘K)"
          className="text-muted-foreground hover:text-foreground lg:hidden"
        >
          <Search />
        </Button>
        <ConnectionIndicator />
        {/* Without the scope the bell would poll into a 403 and its click would
            bounce off the route's own scopeGuard — hide it like the nav item. */}
        <ScopeGuard scope="notifications:r">
          <NotificationBell />
        </ScopeGuard>
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

function DisconnectedBanner() {
  const status = useRealtimeStatus((s) => s.status);
  // Only flag a genuine drop (reconnecting) — not the brief initial connect.
  if (status !== "reconnecting") return null;
  return (
    // Announced, not just coloured: without this a screen-reader operator gets
    // no signal that the data on screen went stale.
    <div
      role="status"
      className="border-b border-warning/25 bg-warning/10 px-4 py-1.5 text-center text-xs font-medium text-warning"
    >
      Realtime disconnected — showing last known data while reconnecting.
    </div>
  );
}

/** Routes that own the whole content area (their own scroll regions, pinned bars). */
function isFullBleed(pathname: string): boolean {
  return pathname === "/" || /^\/pipelines\/(new|[^/]+\/edit)$/.test(pathname);
}

export function AppShell() {
  const narrow = useIsNarrow();
  // No stored preference → collapse on phones, where a 240px rail is most of the screen.
  const [collapsed, setCollapsed] = useState(
    () =>
      readStoredFlag(COLLAPSED_KEY) ?? (typeof window !== "undefined" && window.innerWidth < 768),
  );
  const navigate = useNavigate();
  const apiKey = useAuthStore((s) => s.apiKey);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mainRef = useRef<HTMLElement>(null);
  // Below `md` the open sidebar floats over the page instead of eating its width.
  const overlay = narrow && !collapsed;
  const fullBleed = isFullBleed(pathname);

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

  // …and so should Escape, like any other overlay.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollapsed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ~35 nav links precede the page content — WCAG 2.4.1. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      {overlay && (
        <div
          aria-hidden
          onClick={() => setCollapsed(true)}
          className="fixed inset-0 z-30 bg-black/40 animate-fade-in"
        />
      )}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-14" : "w-60",
          narrow && collapsed && "hidden",
          overlay && "fixed inset-y-0 left-0 z-40 w-64 shadow-dialog",
        )}
      >
        <div
          className={cn(
            "flex h-12 shrink-0 items-center border-b border-border",
            collapsed && !overlay ? "justify-center" : "px-3",
          )}
        >
          <Link
            to="/"
            aria-label="AgentOS home"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
              A
            </span>
            {(!collapsed || overlay) && (
              <span className="text-sm font-semibold tracking-tight">AgentOS</span>
            )}
          </Link>
        </div>
        <Sidebar collapsed={collapsed && !overlay} pathname={pathname} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onToggleSidebar={toggleCollapsed} pathname={pathname} />
        <DisconnectedBanner />
        {/* Chat and the builder own the whole content area (their own scroll
            regions + pinned bars); every other page scrolls inside main. */}
        <main
          id="main"
          tabIndex={-1}
          ref={mainRef}
          className={cn(
            "flex min-h-0 flex-1 flex-col focus:outline-none",
            fullBleed ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          <PageTransition
            key={pathname}
            className={fullBleed ? "flex min-h-0 flex-1 flex-col" : "w-full px-4 py-4 sm:px-6 sm:py-5"}
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
