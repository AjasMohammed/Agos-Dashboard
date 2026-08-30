import {
  LayoutDashboard,
  Bot,
  ListTodo,
  Wrench,
  MessagesSquare,
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
  DollarSign,
  Settings,
  Stethoscope,
  FileText,
  Cpu,
  Lock,
  NotebookPen,
  Store,
  Sparkles,
  Activity as ActivityIcon,
  type LucideIcon,
  LayoutTemplate,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Read scope gating visibility; omitted = always shown. */
  scope?: string;
  /** Shown at the top of the sidebar; everything else folds under "More". */
  primary?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** The single source of truth for the sidebar nav and the generated route tree. */
export const NAV: NavGroup[] = [
  {
    label: "Operate",
    items: [
      // Chat is the home surface; the dashboard is one click away.
      { label: "Chat", to: "/", icon: MessagesSquare, scope: "chat:r", primary: true },
      { label: "Activity", to: "/activity", icon: ActivityIcon, scope: "tasks:r", primary: true },
      { label: "Agents", to: "/agents", icon: Bot, scope: "agents:r", primary: true },
      { label: "Tasks", to: "/tasks", icon: ListTodo, scope: "tasks:r" },
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, primary: true },
      { label: "Tools", to: "/tools", icon: Wrench, scope: "tools:r" },
      { label: "Agent chats", to: "/agent-chats", icon: Bot, scope: "agents:r" },
    ],
  },
  {
    label: "Automate",
    items: [
      { label: "Pipelines", to: "/pipelines", icon: Workflow, scope: "pipelines:r" },
      { label: "Schedules", to: "/schedules", icon: CalendarClock, scope: "schedules:r", primary: true },
    ],
  },
  {
    label: "Govern",
    items: [
      { label: "Needs your approval", to: "/escalations", icon: ShieldAlert, scope: "escalations:r", primary: true },
      { label: "Always allow", to: "/approval-policies", icon: ShieldCheck, scope: "approvals:r" },
      { label: "Notifications", to: "/notifications", icon: BellRing, scope: "notifications:r" },
      { label: "What I've learned about you", to: "/prefs", icon: SlidersHorizontal, scope: "prefs:r" },
      { label: "Permission sets", to: "/roles", icon: KeyRound, scope: "roles:r" },
      { label: "Audit", to: "/audit", icon: ScrollText, scope: "audit:r" },
    ],
  },
  {
    label: "Integrate",
    items: [
      { label: "Plugins", to: "/plugins", icon: Puzzle, scope: "plugins:r" },
      { label: "Channels", to: "/channels", icon: Radio, scope: "channels:r" },
      { label: "Tool servers (MCP)", to: "/mcp", icon: Plug, scope: "mcp:r" },
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
      { label: "Agent notes", to: "/scratchpad", icon: NotebookPen, scope: "scratchpad:r" },
      { label: "API keys & credentials", to: "/secrets", icon: Lock, scope: "secrets:r" },
      { label: "API keys", to: "/keys", icon: KeySquare, scope: "keys:r" },
      { label: "Costs", to: "/costs", icon: DollarSign, scope: "costs:r" },
      { label: "Config", to: "/config", icon: Settings, scope: "config:r" },
      { label: "Health check", to: "/doctor", icon: Stethoscope, scope: "doctor:r" },
      { label: "Logs", to: "/logs", icon: FileText, scope: "logs:r" },
      { label: "System resources", to: "/resources", icon: Cpu, scope: "resources:r" },
    ],
  },
];

/** Flat list of every feature route (used to generate the router tree). */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/** Sidebar top section, in NAV order. */
export const PRIMARY_NAV: NavItem[] = NAV_ITEMS.filter((i) => i.primary);

/** Everything else, grouped — folded under "More" in the sidebar. */
export const MORE_NAV: NavGroup[] = NAV.map((g) => ({
  ...g,
  items: g.items.filter((i) => !i.primary),
})).filter((g) => g.items.length > 0);
