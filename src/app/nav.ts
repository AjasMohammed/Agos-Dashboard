import {
  LayoutDashboard,
  Bot,
  ListTodo,
  Wrench,
  MessagesSquare,
  Workflow,
  CalendarClock,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  KeyRound,
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
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Read scope gating visibility; omitted = always shown. */
  scope?: string;
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
      { label: "Dashboard", to: "/", icon: LayoutDashboard },
      { label: "Agents", to: "/agents", icon: Bot, scope: "agents:r" },
      { label: "Tasks", to: "/tasks", icon: ListTodo, scope: "tasks:r" },
      { label: "Tools", to: "/tools", icon: Wrench, scope: "tools:r" },
      { label: "Chat", to: "/chat", icon: MessagesSquare, scope: "chat:r" },
    ],
  },
  {
    label: "Automate",
    items: [
      { label: "Pipelines", to: "/pipelines", icon: Workflow, scope: "pipelines:r" },
      { label: "Schedules", to: "/schedules", icon: CalendarClock, scope: "schedules:r" },
    ],
  },
  {
    label: "Govern",
    items: [
      { label: "Escalations", to: "/escalations", icon: ShieldAlert, scope: "escalations:r" },
      { label: "Standing grants", to: "/approval-policies", icon: ShieldCheck, scope: "approvals:r" },
      { label: "Preferences", to: "/prefs", icon: SlidersHorizontal, scope: "prefs:r" },
      { label: "Roles", to: "/roles", icon: KeyRound, scope: "roles:r" },
      { label: "Audit", to: "/audit", icon: ScrollText, scope: "audit:r" },
    ],
  },
  {
    label: "Integrate",
    items: [
      { label: "Plugins", to: "/plugins", icon: Puzzle, scope: "plugins:r" },
      { label: "Channels", to: "/channels", icon: Radio, scope: "channels:r" },
      { label: "MCP", to: "/mcp", icon: Plug, scope: "mcp:r" },
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
      { label: "Files", to: "/files", icon: FolderOpen, scope: "files:r" },
      { label: "Scratchpad", to: "/scratchpad", icon: NotebookPen, scope: "scratchpad:r" },
      { label: "Secrets", to: "/secrets", icon: Lock, scope: "secrets:r" },
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
