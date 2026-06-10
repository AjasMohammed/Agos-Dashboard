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
export type PipelineSummary = S["ApiPipelineSummary"];
export type WorkflowSummary = S["ApiWorkflowSummary"];

// Governance
export type Escalation = S["ApiEscalation"];
export type PrefProposal = S["ApiPrefProposal"];
export type ProposalStats = S["ApiProposalStats"];
export type Role = S["ApiRole"];

// Extensibility
export type PluginSummary = S["ApiPluginSummary"];
export type ChannelSummary = S["ApiChannelSummary"];
export type McpServer = S["ApiMcpServer"];
export type ConnectorSummary = S["ApiConnectorSummary"];
export type WebhookEndpoint = S["ApiWebhookEndpoint"];
export type EventSubscription = S["ApiEventSubscription"];
export type CreateSubscriptionRequest = S["CreateSubscriptionRequest"];

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
