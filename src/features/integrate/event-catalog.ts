/**
 * Client-side catalog of subscribable kernel events.
 *
 * The event lists and permission resources come from the GENERATED
 * `events.gen.ts` (sourced from the kernel's `SUBSCRIBABLE_EVENTS` table — the
 * same table `parse_event_type` reads, so the catalog can't drift from the
 * parser). This file only curates display: labels and category order. A
 * category the kernel adds that isn't curated yet still appears, with a
 * humanized fallback label.
 *
 * Each category's `resource` is the bare permission resource string the agent's
 * `permissions` list reports (e.g. `events.security`); granting observe access
 * uses the `:o` flag form (e.g. `events.security:o`).
 */
import { EVENT_CATALOG_GEN } from "@/realtime/events.gen";

export interface EventCategory {
  /** PascalCase name used in the API's `category:<name>` filter. */
  value: string;
  /** Human-readable category name. */
  label: string;
  /** Bare permission resource (matches the agent `permissions` list verbatim). */
  resource: string;
  /** Parser-accepted event type names in this category (PascalCase). */
  events: string[];
}

/** Curated display order + labels; data (events, resource) is generated. */
const CURATED: { value: string; label: string }[] = [
  { value: "TaskLifecycle", label: "Tasks" },
  { value: "AgentLifecycle", label: "Agents" },
  { value: "AgentCommunication", label: "Agent messages" },
  { value: "ScheduleEvents", label: "Schedules" },
  { value: "SystemHealth", label: "System health" },
  { value: "SecurityEvents", label: "Security" },
  { value: "ToolEvents", label: "Tools" },
  { value: "MemoryEvents", label: "Memory" },
  { value: "HardwareEvents", label: "Hardware" },
  { value: "ExternalEvents", label: "External / webhooks" },
];

export const EVENT_CATALOG: EventCategory[] = [
  // Curated categories, in display order.
  ...CURATED.flatMap(({ value, label }) => {
    const gen = EVENT_CATALOG_GEN.find((c) => c.value === value);
    return gen ? [{ value, label, resource: gen.resource, events: [...gen.events] }] : [];
  }),
  // Any category the kernel added that isn't curated yet — never drop data.
  ...EVENT_CATALOG_GEN.filter((c) => !CURATED.some((k) => k.value === c.value)).map((c) => ({
    value: c.value,
    label: humanizeEvent(c.value),
    resource: c.resource,
    events: [...c.events],
  })),
];

/** Map a PascalCase event type to the category that owns it (or undefined). */
const CATEGORY_BY_EVENT = new Map<string, EventCategory>(
  EVENT_CATALOG.flatMap((c) => c.events.map((e) => [e, c] as const)),
);
const CATEGORY_BY_VALUE = new Map(EVENT_CATALOG.map((c) => [c.value, c]));

/**
 * Turn a subscription selection (`all`, `category:<Name>`, or a bare event type)
 * into the set of bare permission resources it observes.
 */
export function requiredResourcesFor(selection: string): string[] {
  if (selection === "all") return EVENT_CATALOG.map((c) => c.resource);
  if (selection.startsWith("category:")) {
    const cat = CATEGORY_BY_VALUE.get(selection.slice("category:".length));
    return cat ? [cat.resource] : [];
  }
  const cat = CATEGORY_BY_EVENT.get(selection);
  return cat ? [cat.resource] : [];
}

/** Humanize a PascalCase event type for display, keeping acronyms intact. */
export function humanizeEvent(eventType: string): string {
  return eventType
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

/**
 * Top-level payload fields a user can write a payload filter against, per event
 * type. Sourced from the kernel emit sites (the `serde_json::json!({...})` each
 * event is emitted with), NOT guessed — so a suggested field actually exists on
 * the payload. Only scalar / string fields are listed; nested arrays-of-objects
 * (e.g. DiskSpaceLow's `mounts`) are omitted because the filter DSL can't index
 * into them. Events that emit no payload (or are never emitted) are absent here.
 */
export const EVENT_FIELDS: Record<string, string[]> = {
  // Tasks
  TaskStarted: ["task_id", "agent_id", "prompt_preview"],
  TaskCompleted: ["task_id", "agent_id", "iterations"],
  TaskFailed: ["task_id", "agent_id", "reason", "error"],
  TaskTimedOut: ["task_id", "agent_id", "timeout_seconds", "elapsed_seconds"],
  TaskDelegated: ["parent_task_id", "child_task_id", "parent_agent_id", "target_agent_id", "target_agent_name"],
  TaskRetrying: ["task_id", "agent_id", "reason", "retry_eligible", "action"],
  TaskDeadlockDetected: ["blocked_agent", "holder_agent", "resource_id"],
  TaskPreempted: ["preempted_agent", "preempting_agent", "resource_id"],
  // Agents
  AgentAdded: ["agent_id", "agent_name", "model"],
  AgentRemoved: ["agent_id", "agent_name"],
  AgentPermissionGranted: ["agent_id", "agent_name", "permission"],
  AgentPermissionRevoked: ["agent_id", "agent_name", "permission"],
  // Agent messages
  DirectMessageReceived: ["from_agent", "to_agent", "message_id"],
  BroadcastReceived: ["from_agent", "recipient_count", "message_id", "group_id"],
  DelegationReceived: ["child_task_id", "parent_task_id", "delegating_agent_id", "target_agent_id", "target_agent_name"],
  DelegationResponseReceived: ["parent_task_id", "child_task_id", "child_agent_id", "outcome"],
  MessageDeliveryFailed: ["from_agent", "to_agent", "message_id", "reason"],
  AgentUnreachable: ["unreachable_agent", "from_agent", "reason"],
  // Schedules
  CronJobFired: ["schedule_id", "schedule_name", "cron_expression", "run_count"],
  ScheduledTaskMissed: ["schedule_id", "schedule_name", "agent_name", "reason"],
  ScheduledTaskCompleted: ["schedule_id", "schedule_name", "agent_name", "completed_at"],
  ScheduledTaskFailed: ["schedule_id", "schedule_name", "agent_name", "error"],
  // System health
  CPUSpikeDetected: ["cpu_percent", "threshold"],
  MemoryPressure: ["memory_percent", "memory_used_mb", "memory_total_mb", "threshold"],
  ProcessCrashed: ["agent_id", "task_id", "binary", "pid", "status", "exit_code", "task_kind", "error"],
  NetworkInterfaceDown: ["interface"],
  ContainerResourceQuotaExceeded: ["resource", "usage_percent", "limit_bytes", "usage_bytes"],
  KernelSubsystemError: ["task_kind", "reason", "max_restarts"],
  // Security
  PromptInjectionAttempt: ["task_id", "agent_id", "source", "tool_name", "threat_level", "pattern_count"],
  CapabilityViolation: ["task_id", "agent_id", "tool_name", "violation_reason", "action_taken"],
  UnauthorizedToolAccess: ["task_id", "agent_id", "requested_tool", "failure_reason", "action_taken"],
  SecretsAccessAttempt: ["action", "key", "allowed"],
  SandboxEscapeAttempt: ["task_id", "agent_id", "tool_name", "violation"],
  AgentImpersonationAttempt: ["claimed_agent_id", "source", "reason"],
  UnverifiedToolInstalled: ["tool_id", "tool_name", "trust_tier"],
  // Tools
  ToolInstalled: ["tool_id", "tool_name", "trust_tier", "description"],
  ToolRemoved: ["tool_id", "tool_name"],
  ToolExecutionFailed: ["task_id", "agent_id", "tool_name", "error", "execution_mode"],
  ToolSandboxViolation: ["task_id", "agent_id", "tool_name", "violation"],
  ToolResourceQuotaExceeded: ["task_id", "agent_id", "tool_name", "error"],
  ToolChecksumMismatch: ["tool_name", "expected_checksum", "actual_checksum"],
  ToolRegistryUpdated: ["action", "tool_name"],
  // Memory
  ContextWindowNearLimit: ["task_id", "agent_id", "estimated_tokens", "max_tokens", "utilization_percent"],
  ContextWindowExhausted: ["task_id", "agent_id", "action"],
  EpisodicMemoryWritten: ["task_id", "agent_id", "entry_type", "summary"],
  SemanticMemoryConflict: ["agent_id", "tool_name", "conflict_type", "updated_count"],
  MemorySearchFailed: ["agent_id", "task_id", "search_type", "query_count"],
  WorkingMemoryEviction: ["task_id", "agent_id", "entries_evicted"],
  // Hardware
  GPUAvailable: ["gpu_name", "vram_total_mb"],
  GPUMemoryPressure: ["gpu_name", "gpu_vram_percent", "vram_used_mb", "vram_total_mb", "threshold"],
  SensorReadingThresholdExceeded: ["sensor_name", "value", "threshold"],
  DeviceConnected: ["device_id", "device_type"],
  DeviceDisconnected: ["device_id", "reason", "agent"],
  HardwareAccessGranted: ["device_id", "approved_by", "agent"],
  DeviceMounted: ["driver", "device", "mount_path"],
  DeviceUnmounted: ["driver", "device"],
  DeviceEjected: ["driver", "device"],
  PrintJobSubmitted: ["driver", "printer", "printer_uri", "job_id", "job_name", "document_name"],
  PrintJobCancelled: ["driver", "printer", "printer_uri", "job_id"],
  AudioCaptureStarted: ["driver", "source", "audio_path", "sample_rate", "duration_seconds"],
  AudioCaptureStopped: ["driver", "source", "audio_path", "sample_rate", "duration_seconds"],
  AudioPlaybackStarted: ["driver", "sink", "audio_path"],
  WebcamCaptureStopped: ["driver", "device", "image_path", "width", "height", "format"],
  BluetoothScanStarted: ["driver", "adapter", "scan_duration_seconds", "device_count"],
  BluetoothPairRequested: ["driver", "adapter", "address", "name"],
  BluetoothConnected: ["driver", "adapter", "address", "name"],
  // External
  WebhookReceived: ["endpoint_id", "agent_id", "task_id", "event_count", "provider"],
};

/** True when a selection targets one specific event type (not "all"/"category:"). */
export function isExactSelection(selection: string): boolean {
  return selection !== "all" && !selection.startsWith("category:");
}

/**
 * Event types the kernel parser accepts but that no kernel code path actually
 * emits today (verified against emit sites). Subscribing to one is valid but
 * the subscription will never fire naturally — the UI labels them so users
 * don't wire up a dead trigger. They can still be exercised via "emit test event".
 */
export const NEVER_EMITTED = new Set([
  "AuditLogTamperAttempt",
  "WebcamCaptureStarted",
  "ExternalFileChanged",
  "ExternalAPIEvent",
  "ExternalAlertReceived",
]);

/**
 * A pretty-printed JSON skeleton for an event's known payload fields, to seed
 * the "emit test event" editor (all values blank for the user to fill in).
 * Returns `{}` for events with no mapped fields.
 */
export function payloadSkeleton(eventType: string): string {
  const fields = EVENT_FIELDS[eventType] ?? [];
  if (fields.length === 0) return "{}";
  return JSON.stringify(Object.fromEntries(fields.map((f) => [f, ""])), null, 2);
}

// ── List prettifying ──────────────────────────────────────────────────────────
// The API renders `event_type_filter` and `throttle` via Rust `{:?}` (e.g.
// `Category(SecurityEvents)`, `Exact(DiskSpaceLow)`, `MaxOncePerDuration(300s)`).
// These turn those debug strings into the same friendly language as the form.

const CATEGORY_BY_NAME = new Map(EVENT_CATALOG.map((c) => [c.value, c]));

/** `All` / `Category(X)` / `Exact(Y)` → human text. Unknown shapes pass through. */
export function prettifyFilter(debugStr: string): string {
  const s = debugStr.trim();
  if (s === "All") return "All events";
  const cat = s.match(/^Category\((.+)\)$/);
  if (cat) {
    const c = CATEGORY_BY_NAME.get(cat[1]);
    return c ? `Any ${c.label.toLowerCase()} event` : `Any ${cat[1]} event`;
  }
  const exact = s.match(/^Exact\((.+)\)$/);
  if (exact) return humanizeEvent(exact[1]);
  return s;
}

// Throttle durations are stored in whole seconds (the original m/h unit is
// lost), so this promotes round values to m/h purely as display sugar — it's a
// lossless re-expression of the same duration, not unit preservation.
function humanizeDuration(secs: number): string {
  if (secs > 0 && secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs > 0 && secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

/** `None` / `MaxOncePerDuration(Ns)` / `MaxCountPerDuration(c, Ns)` → human text. */
export function prettifyThrottle(debugStr: string): string {
  const s = debugStr.trim();
  if (s === "None") return "—";
  const once = s.match(/^MaxOncePerDuration\((\d+)s\)$/);
  if (once) return `Once per ${humanizeDuration(Number(once[1]))}`;
  const max = s.match(/^MaxCountPerDuration\((\d+),\s*(\d+)s\)$/);
  if (max) return `Max ${max[1]} per ${humanizeDuration(Number(max[2]))}`;
  return s;
}

// ── Payload-filter validation ─────────────────────────────────────────────────
// Mirrors the kernel grammar (event_bus.rs): predicates `field OP value` joined
// by whitespace-bounded `and`, OP ∈ == != > >= < <= in contains. The kernel
// fails *open* on a bad filter (matches everything), so catching typos in the UI
// before submit prevents an agent being triggered on every event by accident.

const PREDICATE_RE = /^([A-Za-z0-9_.-]+)\s*(==|!=|>=|<=|>|<|in|contains)\s*(.+)$/i;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** Split on whitespace-bounded `and`, respecting quotes and `[...]` lists. */
function splitClauses(input: string): string[] {
  const s = input.trim();
  const out: string[] = [];
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ((inSingle || inDouble) && escape) {
      escape = false;
      continue;
    }
    if ((inSingle || inDouble) && ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "[" && !inSingle && !inDouble) depth++;
    else if (ch === "]" && !inSingle && !inDouble && depth > 0) depth--;

    if (
      !inSingle &&
      !inDouble &&
      depth === 0 &&
      s[i]?.toLowerCase() === "a" &&
      s[i + 1]?.toLowerCase() === "n" &&
      s[i + 2]?.toLowerCase() === "d" &&
      (i === 0 || /\s/.test(s[i - 1])) &&
      (i + 3 >= s.length || /\s/.test(s[i + 3]))
    ) {
      out.push(s.slice(start, i).trim());
      start = i + 3;
      i += 2;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/**
 * Validate a payload filter the way the kernel parser would. Returns an error
 * message for the first problem, or null when the filter is valid (or empty —
 * the filter is optional).
 */
export function validateFilter(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  for (const clause of splitClauses(trimmed)) {
    if (!clause) return "Empty condition — remove a stray 'and'.";
    const m = clause.match(PREDICATE_RE);
    if (!m) return `“${clause}” isn’t a valid condition (use: field == value).`;
    const op = m[2].toLowerCase();
    const value = m[3].trim();
    if (!value) return `“${clause}” is missing a value.`;
    if (op === "in") {
      if (!(value.startsWith("[") && value.endsWith("]"))) {
        return `“${op}” needs a list, e.g. [a, b, c].`;
      }
    } else if (op === ">" || op === ">=" || op === "<" || op === "<=") {
      if (!NUMERIC_RE.test(value)) return `“${op}” needs a number, got “${value}”.`;
    } else if (op === "contains") {
      // The kernel's CONTAINS requires a string haystack — a bare number/bool is rejected.
      if (NUMERIC_RE.test(value) || /^(true|false)$/i.test(value)) {
        return `“contains” needs text, not a number or true/false.`;
      }
    }
  }
  return null;
}

/**
 * Suggested filterable fields for a selection:
 * - exact event → that event's known fields,
 * - category → the fields common to *every* event in the category (so a
 *   suggested field is guaranteed present on whichever event actually fires),
 * - "all" → none (too heterogeneous to suggest anything reliable).
 */
export function fieldsForSelection(selection: string): string[] {
  if (selection === "all") return [];
  if (selection.startsWith("category:")) {
    const cat = CATEGORY_BY_VALUE.get(selection.slice("category:".length));
    if (!cat) return [];
    const lists = cat.events.map((e) => EVENT_FIELDS[e] ?? []);
    if (lists.length === 0 || lists.some((l) => l.length === 0)) return [];
    return lists.reduce((common, l) => common.filter((f) => l.includes(f)));
  }
  return EVENT_FIELDS[selection] ?? [];
}
