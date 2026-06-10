/**
 * Client-side catalog of subscribable kernel events.
 *
 * The REST API exposes no event-type discovery endpoint, so the panel ships its
 * own catalog. Only event types accepted by the kernel's `parse_event_type`
 * (event_bus.rs) are listed here — the EventType enum has a handful of extra
 * variants the parser rejects, which are intentionally omitted.
 *
 * Each category's `resource` is the bare permission resource string the agent's
 * `permissions` list reports (e.g. `events.security`); granting observe access
 * uses the `:o` flag form (e.g. `events.security:o`).
 */

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

export const EVENT_CATALOG: EventCategory[] = [
  {
    value: "TaskLifecycle",
    label: "Tasks",
    resource: "events.task_lifecycle",
    events: [
      "TaskStarted",
      "TaskCompleted",
      "TaskFailed",
      "TaskTimedOut",
      "TaskDelegated",
      "TaskRetrying",
      "TaskDeadlockDetected",
      "TaskPreempted",
    ],
  },
  {
    value: "AgentLifecycle",
    label: "Agents",
    resource: "events.agent_lifecycle",
    events: ["AgentAdded", "AgentRemoved", "AgentPermissionGranted", "AgentPermissionRevoked"],
  },
  {
    value: "AgentCommunication",
    label: "Agent messages",
    resource: "events.agent_communication",
    events: [
      "DirectMessageReceived",
      "BroadcastReceived",
      "DelegationReceived",
      "DelegationResponseReceived",
      "MessageDeliveryFailed",
      "AgentUnreachable",
    ],
  },
  {
    value: "ScheduleEvents",
    label: "Schedules",
    resource: "events.schedule",
    events: ["CronJobFired", "ScheduledTaskMissed", "ScheduledTaskCompleted", "ScheduledTaskFailed"],
  },
  {
    value: "SystemHealth",
    label: "System health",
    resource: "events.system_health",
    events: [
      "CPUSpikeDetected",
      "MemoryPressure",
      "DiskSpaceLow",
      "DiskSpaceCritical",
      "ProcessCrashed",
      "NetworkInterfaceDown",
      "ContainerResourceQuotaExceeded",
      "KernelSubsystemError",
    ],
  },
  {
    value: "SecurityEvents",
    label: "Security",
    resource: "events.security",
    events: [
      "PromptInjectionAttempt",
      "CapabilityViolation",
      "UnauthorizedToolAccess",
      "SecretsAccessAttempt",
      "SandboxEscapeAttempt",
      "AuditLogTamperAttempt",
      "AgentImpersonationAttempt",
      "UnverifiedToolInstalled",
    ],
  },
  {
    value: "ToolEvents",
    label: "Tools",
    resource: "events.tool",
    events: [
      "ToolInstalled",
      "ToolRemoved",
      "ToolExecutionFailed",
      "ToolSandboxViolation",
      "ToolResourceQuotaExceeded",
      "ToolChecksumMismatch",
      "ToolRegistryUpdated",
    ],
  },
  {
    value: "MemoryEvents",
    label: "Memory",
    resource: "events.memory",
    events: [
      "ContextWindowNearLimit",
      "ContextWindowExhausted",
      "EpisodicMemoryWritten",
      "SemanticMemoryConflict",
      "MemorySearchFailed",
      "WorkingMemoryEviction",
    ],
  },
  {
    value: "HardwareEvents",
    label: "Hardware",
    resource: "events.hardware",
    events: [
      "GPUAvailable",
      "GPUMemoryPressure",
      "SensorReadingThresholdExceeded",
      "DeviceConnected",
      "DeviceDisconnected",
      "HardwareAccessGranted",
      "DeviceMounted",
      "DeviceUnmounted",
      "DeviceEjected",
      "PrintJobSubmitted",
      "PrintJobCancelled",
      "AudioCaptureStarted",
      "AudioCaptureStopped",
      "AudioPlaybackStarted",
      "WebcamCaptureStarted",
      "WebcamCaptureStopped",
      "BluetoothScanStarted",
      "BluetoothPairRequested",
      "BluetoothConnected",
    ],
  },
  {
    value: "ExternalEvents",
    label: "External / webhooks",
    resource: "events.external",
    events: ["WebhookReceived", "ExternalFileChanged", "ExternalAPIEvent", "ExternalAlertReceived"],
  },
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
