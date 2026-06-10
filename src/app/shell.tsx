import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, PanelLeftClose, PanelLeft, LogOut, Moon, Sun, Monitor } from "lucide-react";
import { NAV } from "./nav";
import { useTheme, type Theme } from "./theme";
import { useAuthStore } from "@/auth/store";
import { logout } from "@/auth/actions";
import { useRealtimeStatus } from "@/realtime/connection";
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

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const can = useAuthStore((s) => s.can);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-4 overflow-y-auto overflow-x-hidden p-3">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.scope || can(i.scope));
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            {!collapsed && (
              <p className="px-2 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      title={item.label}
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
                      <Icon
                        className={cn("relative z-10 size-4 shrink-0", active && "text-primary")}
                      />
                      {!collapsed && <span className="relative z-10 truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

const STATUS_LABEL: Record<string, { color: string; pulse: boolean; label: (s: number) => string }> =
  {
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
  const [unread, setUnread] = useState(0);
  // Live bump on any notifications event; the count clears when the bell is opened.
  useChannel("notifications", () => setUnread((n) => n + 1));
  return (
    <Button
      variant="ghost"
      size="icon"
      title="Notifications"
      className="relative"
      onClick={() => setUnread(0)}
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
        <NotificationBell />
        <ThemeToggle />
        <div className="mx-1 hidden text-right sm:block">
          <p className="text-xs font-medium leading-tight">{name ?? "operator"}</p>
          <p className="font-mono text-[10px] leading-tight text-muted-foreground">
            {scopes.length === 0 ? "full access" : `${scopes.length} scope(s)`}
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
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const apiKey = useAuthStore((s) => s.apiKey);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // If the session is cleared while on a protected page (e.g. a background 401),
  // redirect to login instead of leaving the user on a now-broken page.
  useEffect(() => {
    if (!apiKey) navigate({ to: "/login", search: { redirect: undefined } });
  }, [apiKey, navigate]);
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <motion.aside
        animate={{ width: collapsed ? 64 : 240 }}
        transition={{ duration: 0.25, ease: EASE_OUT }}
        className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-card/40"
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
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <PanelLeft /> : <PanelLeftClose />}
          </Button>
        </div>
        <Sidebar collapsed={collapsed} />
      </motion.aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onToggleSidebar={() => setCollapsed((c) => !c)} />
        <DisconnectedBanner />
        <main className="flex-1 overflow-y-auto px-6">
          <PageTransition key={pathname}>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
