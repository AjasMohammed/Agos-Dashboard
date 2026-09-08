import {
  LayoutDashboard,
  Bot,
  ListTodo,
  Wrench,
  MessagesSquare,
  MessageSquareText,
  Workflow,
  CalendarClock,
  ShieldAlert,
  BellRing,
  ShieldCheck,
  SlidersHorizontal,
  KeyRound,
  KeySquare,
  ScrollText,
  Puzzle,
  Radio,
  Plug,
  Link2,
  Webhook,
  Activity,
  FolderOpen,
  FolderLock,
  DollarSign,
  Settings,
  Stethoscope,
  FileText,
  Cpu,
  Lock,
  NotebookPen,
  Store,
  Sparkles,
  LayoutTemplate,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Read scope gating visibility; omitted = always shown. */
  scope?: string;
  /** Lives in the always-open Workspace section; everything else sits in a foldable group. */
  primary?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The single source of truth for the sidebar, the command palette, the topbar
 * breadcrumb and the generated route tree. Labels are short nouns an operator
 * can scan; each page explains itself in its own header.
 */
export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      // Chat is the home surface.
      { label: "Chat", to: "/", icon: MessagesSquare, scope: "chat:r", primary: true },
      { label: "Activity", to: "/activity", icon: Activity, scope: "tasks:r", primary: true },
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, primary: true },
      { label: "Agents", to: "/agents", icon: Bot, scope: "agents:r", primary: true },
      { label: "Tasks", to: "/tasks", icon: ListTodo, scope: "tasks:r", primary: true },
      { label: "Tools", to: "/tools", icon: Wrench, scope: "tools:r", primary: true },
      { label: "Approvals", to: "/escalations", icon: ShieldAlert, scope: "escalations:r", primary: true },
    ],
  },
  {
    label: "Automate",
    items: [
      { label: "Pipelines", to: "/pipelines", icon: Workflow, scope: "pipelines:r" },
      { label: "Schedules", to: "/schedules", icon: CalendarClock, scope: "schedules:r" },
      { label: "Agent chats", to: "/agent-chats", icon: MessageSquareText, scope: "agents:r" },
    ],
  },
  {
    label: "Govern",
    items: [
      { label: "Standing grants", to: "/approval-policies", icon: ShieldCheck, scope: "approvals:r" },
      { label: "Notifications", to: "/notifications", icon: BellRing, scope: "notifications:r" },
      { label: "Preferences", to: "/prefs", icon: SlidersHorizontal, scope: "prefs:r" },
      { label: "Folder access", to: "/workspace-grants", icon: FolderLock, scope: "workspace:r" },
      { label: "Roles", to: "/roles", icon: KeyRound, scope: "roles:r" },
      { label: "Audit log", to: "/audit", icon: ScrollText, scope: "audit:r" },
    ],
  },
  {
    label: "Integrate",
    items: [
      { label: "Plugins", to: "/plugins", icon: Puzzle, scope: "plugins:r" },
      { label: "Channels", to: "/channels", icon: Radio, scope: "channels:r" },
      { label: "MCP servers", to: "/mcp", icon: Plug, scope: "mcp:r" },
      { label: "Connectors", to: "/connectors", icon: Link2, scope: "connectors:r" },
      { label: "Webhooks", to: "/webhooks", icon: Webhook, scope: "webhooks:r" },
      { label: "Events", to: "/events", icon: Activity, scope: "events:r" },
      { label: "Marketplace", to: "/marketplace", icon: Store, scope: "marketplace:r" },
      { label: "Skills", to: "/skills", icon: Sparkles, scope: "skills:r" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Artifacts", to: "/artifacts", icon: LayoutTemplate, scope: "files:r" },
      { label: "Files", to: "/files", icon: FolderOpen, scope: "files:r" },
      { label: "Scratchpad", to: "/scratchpad", icon: NotebookPen, scope: "scratchpad:r" },
      { label: "Secrets", to: "/secrets", icon: Lock, scope: "secrets:r" },
      { label: "API keys", to: "/keys", icon: KeySquare, scope: "keys:r" },
      { label: "Costs", to: "/costs", icon: DollarSign, scope: "costs:r" },
      { label: "Config", to: "/config", icon: Settings, scope: "config:r" },
      { label: "Doctor", to: "/doctor", icon: Stethoscope, scope: "doctor:r" },
      { label: "Logs", to: "/logs", icon: FileText, scope: "logs:r" },
      { label: "Resources", to: "/resources", icon: Cpu, scope: "resources:r" },
    ],
  },
];

/** Flat list of every feature route (used to generate the router tree). */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/** Always-visible Workspace section, in NAV order. */
export const PRIMARY_NAV: NavItem[] = NAV_ITEMS.filter((i) => i.primary);

/** Everything else, grouped — foldable sections in the sidebar. */
export const MORE_NAV: NavGroup[] = NAV.map((g) => ({
  ...g,
  items: g.items.filter((i) => !i.primary),
})).filter((g) => g.items.length > 0);

/** True when `pathname` is this item's page or one of its sub-routes. */
export function isNavActive(item: Pick<NavItem, "to">, pathname: string): boolean {
  if (item.to === "/") return pathname === "/";
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
