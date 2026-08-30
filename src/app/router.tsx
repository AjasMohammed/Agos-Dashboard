/* eslint-disable react-refresh/only-export-components -- this module is the route
   tree: it exports the router and the nav↔page map, and owns two tiny route
   components (the suspense fallback and the 404) that have nowhere better to live. */
import { lazy, Suspense, type FC } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Link,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { Compass, Loader2 } from "lucide-react";
import { AppShell } from "./shell";
import { AppErrorBoundary } from "./app-error-boundary";
import { NAV_ITEMS } from "./nav";
import { LoginPage } from "@/auth/login";
import { WelcomePage } from "@/features/onboarding/welcome-page";
import { isAuthenticated, useAuthStore } from "@/auth/store";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmDialog } from "@/lib/confirm";
import { CommandPalette } from "@/components/command-palette";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
// Type-only import: erased at build time, so it does not drag the tasks page
// back into the eager bundle the way a value import would.
import type { TaskSearch } from "@/features/tasks/tasks-page";

function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Code-split one named page export behind its own chunk. Importing every
 * feature page eagerly put the markdown renderer, react-table and the whole
 * feature tree into the single 921 kB chunk that even `/login` downloads.
 * Same shape as `features/automation/builder/lazy.tsx`; the shell, login and
 * welcome stay eager because they are on the first paint.
 */
function lazyFrom<M extends object>(load: () => Promise<M>, name: keyof M): FC {
  // The cast keeps the *key* type-checked (a renamed export still fails to
  // compile) without demanding every module export be assignable to FC.
  const Lazy = lazy(() => load().then((m) => ({ default: m[name] as unknown as FC })));
  return function LazyPage() {
    return (
      <Suspense fallback={<PageFallback />}>
        <Lazy />
      </Suspense>
    );
  };
}

const ChatPage = lazyFrom(() => import("@/features/chat/chat-page"), "ChatPage");
const AgentsPage = lazyFrom(() => import("@/features/agents/agents-page"), "AgentsPage");
const AgentDetailPage = lazyFrom(
  () => import("@/features/agents/agent-detail-page"),
  "AgentDetailPage",
);
const ArtifactPage = lazyFrom(
  () => import("@/features/artifacts/artifact-page"),
  "ArtifactPage",
);
const TasksPage = lazyFrom(() => import("@/features/tasks/tasks-page"), "TasksPage");
const TaskDetailPage = lazyFrom(
  () => import("@/features/tasks/task-detail-page"),
  "TaskDetailPage",
);
// The builder is already split behind its own React Flow chunk; go through its
// existing wrapper rather than adding a second one.
const PipelineBuilderPage = lazyFrom(
  () => import("@/features/automation/builder/lazy"),
  "PipelineBuilderPage",
);

const govern = (name: keyof typeof import("@/features/govern/govern-pages")) =>
  lazyFrom(() => import("@/features/govern/govern-pages"), name);
const integrate = (name: keyof typeof import("@/features/integrate/integrate-pages")) =>
  lazyFrom(() => import("@/features/integrate/integrate-pages"), name);
const automation = (name: keyof typeof import("@/features/automation/automation-pages")) =>
  lazyFrom(() => import("@/features/automation/automation-pages"), name);
const system = (name: keyof typeof import("@/features/system/system-pages")) =>
  lazyFrom(() => import("@/features/system/system-pages"), name);

/**
 * Simple (no-param) section pages, keyed by nav path. Exported so `nav.test.ts`
 * can hold nav and routes in sync — a key here with no nav entry is silently
 * dropped below and its URL 404s.
 */
export const SECTION_PAGES: Record<string, FC> = {
  "/tools": lazyFrom(() => import("@/features/tools/tools-page"), "ToolsPage"),
  "/dashboard": lazyFrom(() => import("@/features/dashboard/dashboard-page"), "DashboardPage"),
  "/activity": lazyFrom(() => import("@/features/activity/activity-page"), "ActivityPage"),
  "/agent-chats": lazyFrom(() => import("@/features/agents/agent-chats-page"), "AgentChatsPage"),
  "/pipelines": automation("PipelinesPage"),
  "/schedules": automation("SchedulesPage"),
  "/escalations": govern("EscalationsPage"),
  "/approval-policies": govern("StandingGrantsPage"),
  "/notifications": govern("NotificationsPage"),
  "/prefs": govern("PreferencesPage"),
  "/roles": govern("RolesPage"),
  "/audit": govern("AuditPage"),
  "/plugins": integrate("PluginsPage"),
  "/channels": integrate("ChannelsPage"),
  "/mcp": integrate("McpPage"),
  "/connectors": integrate("ConnectorsPage"),
  "/webhooks": integrate("WebhooksPage"),
  "/events": integrate("EventsPage"),
  "/marketplace": integrate("MarketplacePage"),
  "/skills": integrate("SkillsPage"),
  "/artifacts": lazyFrom(
    () => import("@/features/artifacts/artifact-page"),
    "ArtifactsPage",
  ),
  "/files": system("FilesPage"),
  "/scratchpad": system("ScratchpadPage"),
  "/secrets": system("SecretsPage"),
  "/keys": system("KeysPage"),
  "/costs": system("CostsPage"),
  "/config": system("ConfigPage"),
  "/doctor": system("DoctorPage"),
  "/logs": system("LogsPage"),
  "/resources": system("ResourcesPage"),
};

/**
 * Nav destinations routed explicitly below instead of through `SECTION_PAGES`
 * (they carry params or a custom search schema). Exported for the same nav
 * invariant test.
 */
export const EXPLICIT_ROUTE_PATHS = ["/", "/agents", "/tasks"];

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
      <ConfirmDialog />
      <CommandPalette />
    </>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
});

// Full-screen first-run wizard — outside the shell, but still behind auth.
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  beforeLoad: ({ location }) => {
    // pathname, not href: login resumes with `navigate({ to })`, which takes a
    // pathname — an href carrying `?search` 404s after signing in.
    if (!isAuthenticated()) {
      throw redirect({ to: "/login", search: { redirect: location.pathname } });
    }
  },
  component: WelcomePage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: ({ location }) => {
    if (!isAuthenticated()) {
      throw redirect({ to: "/login", search: { redirect: location.pathname } });
    }
  },
  component: AppShell,
  // Deliberately NO errorComponent here: a route's errorComponent *replaces*
  // its component, so a page throw would delete the sidebar, topbar and
  // connection indicator. The shell wraps its own <Outlet/> in a CatchBoundary.
});

/** Redirect to the dashboard if the key lacks the read scope a section requires. */
function scopeGuard(scope?: string) {
  return () => {
    if (scope && !useAuthStore.getState().can(scope)) {
      throw redirect({ to: "/" });
    }
  };
}

// Chat is home. A key without chat:r lands on the (unscoped) dashboard instead
// so scopeGuard's redirect-to-"/" never loops.
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: () => {
    if (!useAuthStore.getState().can("chat:r")) throw redirect({ to: "/dashboard" as string });
  },
  component: ChatPage,
});

// Old bookmarks.
const legacyChatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/chat",
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});

const agentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agents",
  beforeLoad: scopeGuard("agents:r"),
  component: AgentsPage,
});

const agentDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agents/$name",
  beforeLoad: scopeGuard("agents:r"),
  component: AgentDetailPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks",
  beforeLoad: scopeGuard("tasks:r"),
  validateSearch: (s: Record<string, unknown>): TaskSearch => ({
    status: typeof s.status === "string" ? s.status : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    offset:
      typeof s.offset === "number"
        ? s.offset
        : typeof s.offset === "string"
          ? Number(s.offset) || 0
          : undefined,
  }),
  component: TasksPage,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks/$id",
  beforeLoad: scopeGuard("tasks:r"),
  component: TaskDetailPage,
});

// Agent-published artifacts. The detail route is explicit (it carries a param);
// the /artifacts index is a plain section page. Agents hand out relative
// /artifacts/<id> links, so this path is a contract with `artifact-write`.
const artifactRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/artifacts/$id",
  beforeLoad: scopeGuard("files:r"),
  component: ArtifactPage,
});

// Visual builder for pipelines, gated by the section's scope.
// (The Workflows tab is parked — see docs/workflows-tab-parked.md.)
const sectionScope = (path: string) => NAV_ITEMS.find((i) => i.to === path)?.scope;
const builderRoutes = [
  createRoute({
    getParentRoute: () => appRoute,
    path: "/pipelines/new",
    beforeLoad: scopeGuard(sectionScope("/pipelines")),
    component: PipelineBuilderPage,
  }),
  createRoute({
    getParentRoute: () => appRoute,
    path: "/pipelines/$name/edit",
    beforeLoad: scopeGuard(sectionScope("/pipelines")),
    component: PipelineBuilderPage,
  }),
];

// One route per simple section page, scope-gated by its nav entry so a key that
// lacks the read scope can't reach the page by typing the URL.
const sectionRoutes = NAV_ITEMS.filter((item) => SECTION_PAGES[item.to]).map((item) =>
  createRoute({
    getParentRoute: () => appRoute,
    path: item.to,
    beforeLoad: scopeGuard(item.scope),
    component: SECTION_PAGES[item.to],
  }),
);

const routeTree = rootRoute.addChildren([
  loginRoute,
  welcomeRoute,
  appRoute.addChildren([
    indexRoute,
    legacyChatRoute,
    agentsRoute,
    agentDetailRoute,
    tasksRoute,
    taskDetailRoute,
    artifactRoute,
    ...builderRoutes,
    ...sectionRoutes,
  ]),
]);

/**
 * An unmatched URL matches neither `appRoute` (so: no shell, and the auth guard
 * never runs) nor any page, so the 404 has to guard itself — signed-out
 * visitors go to login, signed-in ones get a way back instead of a dead end.
 */
function NotFound() {
  if (!isAuthenticated()) {
    return <Navigate to="/login" search={{ redirect: window.location.pathname }} replace />;
  }
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="That URL doesn't match anything in the panel."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </div>
  );
}

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // root/login/welcome declare no boundary of their own — a throw in the
  // first-run wizard or the login form used to be an unmounted white screen.
  defaultErrorComponent: AppErrorBoundary,
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
