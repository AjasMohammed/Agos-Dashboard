import type { FC } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "./shell";
import { NAV_ITEMS } from "./nav";
import { LoginPage } from "@/auth/login";
import { Placeholder } from "@/routes/placeholder";
import { isAuthenticated, useAuthStore } from "@/auth/store";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmDialog } from "@/lib/confirm";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { AgentsPage } from "@/features/agents/agents-page";
import { AgentDetailPage } from "@/features/agents/agent-detail-page";
import { TasksPage, type TaskSearch } from "@/features/tasks/tasks-page";
import { TaskDetailPage } from "@/features/tasks/task-detail-page";
import { ToolsPage } from "@/features/tools/tools-page";
import { ChatPage } from "@/features/chat/chat-page";
import {
  EscalationsPage,
  RolesPage,
  PreferencesPage,
  AuditPage,
} from "@/features/govern/govern-pages";
import {
  PluginsPage,
  ChannelsPage,
  McpPage,
  ConnectorsPage,
  WebhooksPage,
  EventsPage,
  MarketplacePage,
} from "@/features/integrate/integrate-pages";
import { SchedulesPage, PipelinesPage } from "@/features/automation/automation-pages";
import { PipelineBuilderPage } from "@/features/automation/builder/lazy";
import {
  FilesPage,
  ScratchpadPage,
  SecretsPage,
  CostsPage,
  ConfigPage,
  DoctorPage,
  LogsPage,
  ResourcesPage,
} from "@/features/system/system-pages";

/** Simple (no-param) section pages, keyed by nav path. */
const SECTION_PAGES: Record<string, FC> = {
  "/tools": ToolsPage,
  "/chat": ChatPage,
  "/pipelines": PipelinesPage,
  "/schedules": SchedulesPage,
  "/escalations": EscalationsPage,
  "/prefs": PreferencesPage,
  "/roles": RolesPage,
  "/audit": AuditPage,
  "/plugins": PluginsPage,
  "/channels": ChannelsPage,
  "/mcp": McpPage,
  "/connectors": ConnectorsPage,
  "/webhooks": WebhooksPage,
  "/events": EventsPage,
  "/marketplace": MarketplacePage,
  "/files": FilesPage,
  "/scratchpad": ScratchpadPage,
  "/secrets": SecretsPage,
  "/costs": CostsPage,
  "/config": ConfigPage,
  "/doctor": DoctorPage,
  "/logs": LogsPage,
  "/resources": ResourcesPage,
};

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
      <ConfirmDialog />
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

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: ({ location }) => {
    if (!isAuthenticated()) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AppShell,
});

/** Redirect to the dashboard if the key lacks the read scope a section requires. */
function scopeGuard(scope?: string) {
  return () => {
    if (scope && !useAuthStore.getState().can(scope)) {
      throw redirect({ to: "/" });
    }
  };
}

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: DashboardPage,
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

// Any nav item still without a page falls back to a placeholder (should be none).
const covered = new Set(["/", "/agents", "/tasks", ...Object.keys(SECTION_PAGES)]);
const placeholderRoutes = NAV_ITEMS.filter((item) => !covered.has(item.to)).map((item) =>
  createRoute({
    getParentRoute: () => appRoute,
    path: item.to,
    beforeLoad: scopeGuard(item.scope),
    component: () => <Placeholder title={item.label} />,
  }),
);

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    agentsRoute,
    agentDetailRoute,
    tasksRoute,
    taskDetailRoute,
    ...builderRoutes,
    ...sectionRoutes,
    ...placeholderRoutes,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultNotFoundComponent: () => <Placeholder title="Not found" />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
