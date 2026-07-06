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

// Conversational
export type ChatSessionSummary = S["ApiChatSessionSummary"];
export type ChatSessionDetail = S["ApiChatSessionDetail"];
export type ChatMessage = S["ApiChatMessage"];

// Automation
export type ScheduleSummary = S["ApiScheduleSummary"];
export type ScheduleRun = S["ApiScheduleRun"];
export type MemoryItem = S["ApiMemoryItem"];
export type SkillSummary = S["ApiSkillSummary"];
export type SkillDetail = S["ApiSkillDetail"];
export type InboxMessage = S["ApiInboxMessage"];
export type PipelineSummary = S["ApiPipelineSummary"];
export type WorkflowSummary = S["ApiWorkflowSummary"];

// Governance
export type Escalation = S["ApiEscalation"];
export type PrefProposal = S["ApiPrefProposal"];
export type ProposalStats = S["ApiProposalStats"];
export type Role = S["ApiRole"];
export type ApprovalPolicy = S["ApiApprovalPolicy"];
export type AddApprovalPolicyBody = S["AddApprovalPolicyRequest"];

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
