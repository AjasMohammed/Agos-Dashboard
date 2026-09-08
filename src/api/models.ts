import type { components } from "./types.gen";

type S = components["schemas"];

// Agents
export type AgentSummary = S["ApiAgentSummary"];
export type AgentDetail = S["ApiAgentDetail"];
export type AgentIdentity = S["ApiAgentIdentity"];
export type ConnectAgentRequest = S["ConnectAgentRequest"];
export type UpdateAgentSettingsRequest = S["UpdateAgentSettingsRequest"];

// Tasks
export type TaskSummary = S["ApiTaskSummary"];
export type TaskDetail = S["ApiTaskDetail"];
/**
 * The API's task-state vocabulary, generated from the Rust `ApiTaskStatus`
 * enum. Anything that filters or labels a task status must be typed against
 * this — the panel once sent `completed` while the API said `complete`, and
 * the filter silently returned zero rows for months.
 */
export type TaskStatus = S["ApiTaskStatus"];
export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting",
  "suspended",
  "complete",
  "failed",
  "cancelled",
] as const satisfies readonly TaskStatus[];
/** Compile-time contract check: fails if the API grows a status we don't list. */
type MissingTaskStatus = Exclude<TaskStatus, (typeof TASK_STATUSES)[number]>;
const _taskStatusesAreExhaustive: MissingTaskStatus extends never
  ? true
  : ["unhandled task statuses", MissingTaskStatus] = true;
void _taskStatusesAreExhaustive;

/** Schedule-state vocabulary, generated from the Rust `ApiScheduleState`. */
export type ScheduleState = S["ApiScheduleState"];
export const SCHEDULE_STATES = [
  "active",
  "paused",
  "disabled",
  "pending",
  "fired",
  "cancelled",
] as const satisfies readonly ScheduleState[];
type MissingScheduleState = Exclude<ScheduleState, (typeof SCHEDULE_STATES)[number]>;
const _scheduleStatesAreExhaustive: MissingScheduleState extends never
  ? true
  : ["unhandled schedule states", MissingScheduleState] = true;
void _scheduleStatesAreExhaustive;

/** Narrow an arbitrary string (URL param, old bookmark) to a known status. */
export function asTaskStatus(v: string | undefined): TaskStatus | undefined {
  if (!v) return undefined;
  // `completed` was the panel's own old spelling; keep old links working.
  const normalized = v === "completed" ? "complete" : v;
  return (TASK_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as TaskStatus)
    : undefined;
}
export type RunTaskRequest = S["RunTaskRequest"];
export type CheckpointSummary = S["ApiCheckpointSummary"];

// Task execution trace. The `/tasks/{id}/trace` endpoint returns an untyped
// `Value` envelope in the contract, so these shapes are hand-mirrored from the
// kernel's `TaskTrace` (agos: crates/agentos-types/src/task_trace.rs). This is
// where a task's tool calls and their outputs live — the task DTO itself has no
// output field.
export interface PermissionCheckTrace {
  granted: boolean;
  deny_reason: string | null;
}
export interface ToolCallTrace {
  tool_name: string;
  input_json: unknown;
  output_json: unknown | null;
  error: string | null;
  duration_ms: number;
  permission_check: PermissionCheckTrace;
  injection_score: number | null;
  snapshot_ref: string | null;
}
export interface IterationTrace {
  iteration: number;
  started_at: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  stop_reason: string;
  tool_calls: ToolCallTrace[];
  snapshot_id: string | null;
}
export interface TaskTrace {
  task_id: string;
  agent_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  prompt_preview: string;
  iterations: IterationTrace[];
  snapshot_ids: string[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

// Tools
export type ToolSummary = S["ApiToolSummary"];

// Dashboard / observability
export type DashboardSummary = S["DashboardSummary"];
export type TaskCounts = S["TaskCounts"];
export type AuditEntrySummary = S["AuditEntrySummary"];
export type AuditEntryDetail = S["AuditEntryDetail"];

// Conversational
export type ChatSessionSummary = S["ApiChatSessionSummary"];
export type ChatSessionDetail = S["ApiChatSessionDetail"];
export type ChatMessage = S["ApiChatMessage"];

// Automation
export type ScheduleSummary = S["ApiScheduleSummary"];
export type ScheduleRun = S["ApiScheduleRun"];
export type MemoryItem = S["ApiMemoryItem"];
export type SkillSummary = S["ApiSkillSummary"];
export type Provider = S["ApiProvider"];
export type SkillDetail = S["ApiSkillDetail"];
export type InboxMessage = S["ApiInboxMessage"];
export type PipelineSummary = S["ApiPipelineSummary"];

// Governance
export type Escalation = S["ApiEscalation"];
export type PrefProposal = S["ApiPrefProposal"];
export type ProposalStats = S["ApiProposalStats"];
export type Role = S["ApiRole"];
export type ApprovalPolicy = S["ApiApprovalPolicy"];
export type AddApprovalPolicyBody = S["AddApprovalPolicyRequest"];
export type WorkspaceGrant = S["ApiWorkspaceGrant"];
export type GrantWorkspaceBody = S["GrantWorkspaceRequest"];

// Extensibility
export type PluginSummary = S["ApiPluginSummary"];
export type ChannelSummary = S["ApiChannelSummary"];
export type McpServer = S["ApiMcpServer"];
export type ConnectorSummary = S["ApiConnectorSummary"];
export type WebhookEndpoint = S["ApiWebhookEndpoint"];
export type EventSubscription = S["ApiEventSubscription"];
export type CreateSubscriptionRequest = S["CreateSubscriptionRequest"];
export type EmitEventRequest = S["EmitEventRequest"];

// System
export type FileMeta = S["ApiFileMeta"];
export type ScratchPage = S["ApiScratchPage"];
export interface PageSummary {
  id: string;
  title: string;
  tags: string[];
  updated_at: string;
}
export type CostSummaryEntry = S["CostSummaryEntry"];
export type ConfigTree = S["ConfigTree"];
export type DoctorReport = S["DoctorReport"];
export type LogLine = S["LogLine"];
export type ResourceInfo = S["ResourceInfo"];

// Full-coverage additions (phase 08)
export type ConvoSummary = S["ApiConvoSummary"];
export type ConvoDetail = S["ApiConvoDetail"];
export type ConvoTurn = S["ApiConvoTurn"];
export type NotificationSummary = S["NotificationSummary"];
export type ApiKeyMeta = S["ApiKeyMeta"];
export type IssuedKey = S["IssuedKeyResponse"];
export type CreateKeyRequest = S["CreateKeyRequest"];
export type PluginDetail = S["ApiPluginDetail"];
export type AttachMcpRequest = S["AttachMcpRequest"];
export type McpAttached = S["McpAttachedResponse"];
export type McpCatalogEntry = S["ApiMcpCatalogEntry"];
export type ConnectChannelRequest = S["ConnectChannelRequest"];
export type UpdateChannelRequest = S["UpdateChannelRequest"];
export type Pairings = S["ApiPairings"];
export type PairingEntry = S["ApiPairingEntry"];
export type PendingPairing = S["ApiPendingPairing"];
export type StoreCredentialRequest = S["StoreCredentialRequest"];
export type ConnectorDetail = S["ApiConnectorDetail"];
export type HalInfo = S["HalInfo"];
export type SystemStatus = S["SystemStatus"];
