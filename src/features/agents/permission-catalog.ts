import type { Role, ToolSummary } from "@/api/models";
import { KNOWN_PERMISSIONS } from "./permission-catalog.gen";

/**
 * The five permission bits the kernel understands, in canonical order
 * (agos `agentos-capability/src/permissions.rs`). A grant string is
 * `resource:BITS`, e.g. `fs.user_data:rw`.
 */
export const PERMISSION_BITS = [
  { bit: "r", label: "Read", hint: "Read the resource" },
  { bit: "w", label: "Write", hint: "Create or modify" },
  { bit: "x", label: "Execute", hint: "Run / act on it" },
  { bit: "q", label: "Query", hint: "Query, subscribe, unsubscribe" },
  { bit: "o", label: "Observe", hint: "Watch its event stream" },
] as const;

const ORDER = "rwxqo";

/** Dedupe and canonically order bit characters; drops anything unknown. */
export function sortBits(bits: string): string {
  return [...ORDER].filter((c) => bits.includes(c)).join("");
}

/**
 * Split `"resource:BITS"` the way the kernel does: resources may themselves
 * contain colons (`fs:/data/`), so the bits are whatever follows the LAST one
 * and must be drawn from `rwxqo`. Returns null for anything the kernel would
 * reject, so a malformed manifest entry never reaches the picker.
 */
export function parsePermission(s: string): { resource: string; bits: string } | null {
  const i = s.lastIndexOf(":");
  if (i <= 0) return null;
  const bits = s.slice(i + 1);
  if (!bits || !/^[rwxqo]+$/.test(bits)) return null;
  return { resource: s.slice(0, i), bits: sortBits(bits) };
}

export interface CatalogEntry {
  resource: string;
  /** Union of the bits every source asks for on this resource. */
  bits: string;
  /** Tools whose manifest requires this resource. */
  tools: string[];
  /** Roles that bundle this resource. */
  roles: string[];
}

/**
 * The grantable-permission catalog: every resource the shipped tools can ask
 * for (vendored in `permission-catalog.gen.ts`, because `GET /tools` only
 * reports *installed* tools), merged with what this kernel actually has
 * installed and with the resources roles bundle. Anything outside it — a
 * path-scoped `fs:/data/` prefix — is still typeable in the picker.
 */
export function permissionCatalog(tools: ToolSummary[], roles: Role[]): CatalogEntry[] {
  const byResource = new Map<string, CatalogEntry>();
  const entryFor = (resource: string) => {
    let entry = byResource.get(resource);
    if (!entry) {
      entry = { resource, bits: "", tools: [], roles: [] };
      byResource.set(resource, entry);
    }
    return entry;
  };
  const add = (perm: string, from: "tools" | "roles", name: string) => {
    const parsed = parsePermission(perm);
    if (!parsed) return;
    const entry = entryFor(parsed.resource);
    entry.bits = sortBits(entry.bits + parsed.bits);
    if (!entry[from].includes(name)) entry[from].push(name);
  };
  for (const k of KNOWN_PERMISSIONS) {
    const entry = entryFor(k.resource);
    entry.bits = sortBits(entry.bits + k.bits);
    entry.tools = [...k.tools];
  }
  for (const t of tools) for (const p of t.permissions ?? []) add(p, "tools", t.name);
  for (const r of roles) for (const p of r.permissions ?? []) add(p, "roles", r.name);
  return [...byResource.values()].sort((a, b) => a.resource.localeCompare(b.resource));
}

/** Granted permission strings -> resource -> bits already held. */
export function grantedBits(permissions: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of permissions) {
    const parsed = parsePermission(p);
    if (!parsed) continue;
    map.set(parsed.resource, sortBits((map.get(parsed.resource) ?? "") + parsed.bits));
  }
  return map;
}

/** True when the agent already holds every bit of `resource:bits`. */
export function isGranted(granted: Map<string, string>, resource: string, bits: string): boolean {
  const held = granted.get(resource);
  return !!bits && !!held && [...bits].every((c) => held.includes(c));
}

/** The bits of `resource:bits` the agent does NOT hold yet. */
export function missingBits(
  granted: Map<string, string>,
  resource: string,
  bits: string,
): string {
  const held = granted.get(resource) ?? "";
  return [...bits].filter((c) => !held.includes(c)).join("");
}

/**
 * What each resource actually lets an agent do, in the operator's words. The
 * kernel ships no descriptions for these — the manifests only name them — so
 * this is hand-written and reviewed alongside `permission-catalog.gen.ts`
 * (`npm run generate:permissions` prints any resource missing a hint).
 */
const RESOURCE_HINTS: Record<string, string> = {
  "a2a.delegate": "Hand a task to an agent on another AgentOS instance.",
  "agent.call": "Call another agent and wait for its answer.",
  "agent.message": "Send messages to other agents' inboxes.",
  "agent.registry": "See which agents exist and what they can do.",
  "agent.spawn": "Start, poll and cancel sub-agents.",
  "build.lint": "Run the project's linter.",
  "build.run": "Run the project's build.",
  "build.test": "Run the project's test suite.",
  "channel.send": "Post messages into a channel.",
  "container.create": "Create containers.",
  "container.destroy": "Destroy containers.",
  "container.exec": "Run commands inside a container.",
  "container.list": "List containers and their state.",
  "container.logs": "Read container logs.",
  "env.create": "Create sandboxed dev environments.",
  "env.destroy": "Delete dev environments.",
  "env.install": "Install packages into a dev environment.",
  "env.list": "List dev environments.",
  "escalation.query": "Check the status of approvals it raised.",
  "events.stream": "Subscribe to and watch the kernel event stream.",
  "fs.app_logs": "Read this application's log files.",
  "fs.artifacts": "Write files into the artifact store.",
  "fs.system_logs": "Read the host's system logs.",
  "fs.user_data": "Read and write files in the user-data namespace.",
  "hardware.audio.capture": "Record from microphones.",
  "hardware.audio.list": "List audio input and output devices.",
  "hardware.audio.playback": "Play sound through speakers.",
  "hardware.audio.volume": "Read and change output volume.",
  "hardware.bluetooth.connection": "Connect to and disconnect Bluetooth devices.",
  "hardware.bluetooth.gatt": "Read and write Bluetooth GATT characteristics.",
  "hardware.bluetooth.list": "List known Bluetooth devices.",
  "hardware.bluetooth.pair": "Pair and unpair Bluetooth devices.",
  "hardware.bluetooth.power": "Turn the Bluetooth radio on or off.",
  "hardware.bluetooth.scan": "Scan for nearby Bluetooth devices.",
  "hardware.display": "Read display layout and settings.",
  "hardware.display.config": "Change resolution, scaling and monitor layout.",
  "hardware.homeassistant": "Read Home Assistant state and call its services.",
  "hardware.iot": "Read and set IoT device twins.",
  "hardware.mqtt": "Publish to and subscribe to MQTT topics.",
  "hardware.printer": "Send jobs to printers.",
  "hardware.raw-usb.control": "Send raw USB control transfers.",
  "hardware.raw-usb.list": "List attached USB devices.",
  "hardware.raw-usb.session": "Claim a USB device for exclusive use.",
  "hardware.raw-usb.transfer": "Read and write raw USB endpoints.",
  "hardware.system": "Read CPU, memory, disk and sensor stats.",
  "hardware.usb-storage": "Mount and use USB storage devices.",
  "hardware.webcam.capture": "Capture images and video from cameras.",
  "hardware.webcam.list": "List attached cameras.",
  "memory.blocks": "Read and edit the always-in-context memory blocks.",
  "memory.context": "Read and update the agent's working context memory.",
  "memory.episodic": "Read and write its record of what happened.",
  "memory.procedural": "Read and write learned procedures and how-tos.",
  "memory.semantic": "Read and write long-term facts and archival memory.",
  "net.dns": "Resolve DNS names.",
  "net.http": "Make raw HTTP requests.",
  "net.outbound": "Open outbound connections for package installs.",
  "network.logs": "Read network activity logs.",
  "network.outbound": "Reach the internet \u2014 fetch pages, call APIs, search.",
  "network.sockets": "Inspect open sockets and listening ports.",
  "proc.list": "List processes it started.",
  "proc.output": "Read the output of processes it started.",
  "proc.signal": "Signal processes it started.",
  "proc.spawn": "Start long-running background processes.",
  "proc.wait": "Wait for processes it started to finish.",
  "process.exec": "Run shell commands on the host.",
  "process.kill": "Kill host processes.",
  "process.list": "List host processes.",
  "schedule.job": "Create, list and cancel scheduled jobs.",
  "schedule.self": "Read its own schedules and their run history.",
  "schedule.timer": "Set, list and cancel one-off timers.",
  "scratchpad": "Read and write its scratchpad notes and links.",
  "storage.zone.create": "Create storage zones.",
  "storage.zone.list": "List storage zones.",
  "storage.zone.revoke": "Revoke access to a storage zone.",
  "system.mounts": "Read mounted filesystems.",
  "system.open_files": "Read the host's open-file table.",
  "system.package": "Install packages on the host.",
  "system.services": "Read system service status.",
  "task.query": "List tasks and read their status.",
  "user.interact": "Ask you a question and wait for your reply.",
  "user.notify": "Send you notifications.",
};

/** Fallback by first dot-segment, for a resource typed by hand (`fs:/data/`). */
const FAMILY_HINTS: Record<string, string> = {
  "a2a": "Cross-instance agent delegation.",
  "agent": "Acting on other agents.",
  "build": "Running project build tooling.",
  "channel": "Posting into channels.",
  "chat": "Chat history and conversations.",
  "container": "Managing containers.",
  "env": "Managing sandboxed dev environments.",
  "escalation": "Approval requests it raised.",
  "events": "The kernel event stream.",
  "fs": "Files under this path or namespace.",
  "hardware": "Physical devices attached to the host.",
  "memory": "The agent's own memory.",
  "net": "Network access.",
  "network": "Network access.",
  "proc": "Processes the agent started.",
  "process": "Host processes.",
  "schedule": "Scheduled work and timers.",
  "scratchpad": "The agent's scratchpad notes.",
  "storage": "Storage zones.",
  "system": "Host system information.",
  "task": "Tasks and their status.",
  "user": "Talking to you directly.",
};

/** One line explaining what granting `resource` allows. */
export function resourceHint(resource: string): string {
  const exact = RESOURCE_HINTS[resource];
  if (exact) return exact;
  const prefix = resource.split(/[.:]/)[0] ?? resource;
  return FAMILY_HINTS[prefix] ?? "";
}

/**
 * Display names for the first dot-segment of a resource, so ~80 resources read
 * as a dozen navigable sections instead of one flat wall. Anything unmapped
 * falls back to its own prefix, capitalised.
 */
const GROUP_LABELS: Record<string, string> = {
  a2a: "Agents",
  agent: "Agents",
  build: "Build",
  channel: "Messaging",
  chat: "Messaging",
  container: "Containers",
  env: "Environments",
  escalation: "Governance",
  events: "Events",
  fs: "Filesystem",
  hardware: "Hardware",
  memory: "Memory",
  net: "Network",
  network: "Network",
  proc: "Processes",
  process: "Processes",
  schedule: "Scheduling",
  scratchpad: "Scratchpad",
  storage: "Storage",
  system: "System",
  task: "Tasks",
  user: "User",
};

export function groupOf(resource: string): string {
  const prefix = resource.split(/[.:]/)[0] ?? resource;
  return GROUP_LABELS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/** Catalog entries bucketed by `groupOf`, groups and rows alphabetical. */
export function groupCatalog(entries: CatalogEntry[]): { group: string; entries: CatalogEntry[] }[] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const e of entries) {
    const g = groupOf(e.resource);
    const list = groups.get(g);
    if (list) list.push(e);
    else groups.set(g, [e]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => ({ group, entries: list }));
}
