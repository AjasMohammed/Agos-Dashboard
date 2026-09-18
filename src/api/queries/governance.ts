import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import { notificationKeys } from "./notifications";
import type {
  Escalation,
  PrefProposal,
  ProposalStats,
  Role,
  AuditEntrySummary,
  AuditEntryDetail,
  ApprovalPolicy,
  AddApprovalPolicyBody,
  ResolveEscalationResponse,
  WorkspaceGrant,
  GrantWorkspaceBody,
} from "../models";

// ── Escalations ─────────────────────────────────────────────────────────────
// `pending` nests under `all` on purpose: resolving one refreshes both views.
export const escalationKeys = {
  all: ["escalations"] as const,
  pending: ["escalations", "pending"] as const,
};

export function useEscalations(opts?: {
  enabled?: boolean;
  refetchInterval?: number | false;
  /** Only unresolved rows — what a badge or an in-chat prompt needs, without the whole history. */
  pending?: boolean;
}) {
  const { pending = false, ...rest } = opts ?? {};
  return useQuery({
    queryKey: pending ? escalationKeys.pending : escalationKeys.all,
    queryFn: async () =>
      unwrap<Escalation[]>(
        await client.GET("/api/v1/escalations", {
          params: { query: pending ? { pending: true } : {} },
        }),
      ),
    // The kernel auto-denies a pending escalation after 5 min, so a queue left
    // open on screen has to refresh itself — otherwise the operator approves a
    // row the kernel already denied. `opts` may still override.
    refetchInterval: 5000,
    ...rest,
  });
}

export function useResolveEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      decision: string;
      note?: string;
      /**
       * On approve, also mint a standing grant so this tool stops asking. The
       * kernel decides its scope (the agent, and the payload's path when there
       * is one) and refuses to mint one it cannot scope, so the answer is in
       * `remember_note` — show it rather than claiming what was remembered.
       */
      remember?: boolean;
    }) =>
      unwrap<ResolveEscalationResponse>(
        await client.POST("/api/v1/escalations/{id}/resolve", {
          params: { path: { id: Number(vars.id) } },
          body: { decision: vars.decision, note: vars.note, remember: vars.remember },
        }),
      ),
    // A `remember` also mints an approval-policy row, so that list is stale too.
    // The inbox as well: resolving does not retract the escalation's
    // notification row, so without this the bell panel demotes it to a plain row
    // that still reads "Needs your approval" until the next poll.
    // Returned, not fire-and-forget: react-query awaits it, so the button stays
    // disabled until the refetch lands instead of re-enabling over a row the
    // list still shows as pending.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: escalationKeys.all }),
        qc.invalidateQueries({ queryKey: approvalPolicyKeys.all }),
        qc.invalidateQueries({ queryKey: notificationKeys.all }),
      ]),
  });
}

// ── Approval policies (standing grants) ─────────────────────────────────────
export const approvalPolicyKeys = { all: ["approval-policies"] as const };

export function useApprovalPolicies() {
  return useQuery({
    queryKey: approvalPolicyKeys.all,
    queryFn: async () =>
      unwrap<ApprovalPolicy[]>(await client.GET("/api/v1/approval-policies")),
  });
}

export function useAddApprovalPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddApprovalPolicyBody) =>
      unwrap<ApprovalPolicy>(await client.POST("/api/v1/approval-policies", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalPolicyKeys.all }),
  });
}

export function useRevokeApprovalPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      unwrap(await client.DELETE("/api/v1/approval-policies/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalPolicyKeys.all }),
  });
}

// ── Workspace grants (host folder access) ───────────────────────────────────
export const workspaceGrantKeys = { all: ["workspace-grants"] as const };

export function useWorkspaceGrants() {
  return useQuery({
    queryKey: workspaceGrantKeys.all,
    queryFn: async () =>
      unwrap<WorkspaceGrant[]>(await client.GET("/api/v1/workspace-grants")),
  });
}

export function useGrantWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: GrantWorkspaceBody) =>
      unwrap<WorkspaceGrant>(await client.POST("/api/v1/workspace-grants", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceGrantKeys.all }),
  });
}

/**
 * Revoke matches on (path, agent scope) rather than the row id, so the caller
 * has to hand back both — passing the id would revoke nothing.
 */
export function useRevokeWorkspaceGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { path: string; agent_name?: string }) => {
      unwrap(
        await client.DELETE("/api/v1/workspace-grants", {
          params: { query: { path: vars.path, agent_name: vars.agent_name } },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceGrantKeys.all }),
  });
}

// ── Preferences (adaptation proposals) ──────────────────────────────────────
export const prefKeys = { proposals: ["prefs", "proposals"] as const, stats: ["prefs", "stats"] as const };

export function usePrefProposals() {
  return useQuery({
    queryKey: prefKeys.proposals,
    queryFn: async () => unwrap<PrefProposal[]>(await client.GET("/api/v1/prefs/proposals")),
  });
}

export function usePrefStats() {
  return useQuery({
    queryKey: prefKeys.stats,
    queryFn: async () => unwrap<ProposalStats>(await client.GET("/api/v1/prefs/stats")),
  });
}

export function useReviewProposal(action: "accept" | "reject") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const path = `/api/v1/prefs/proposals/{id}/${action}` as
        | "/api/v1/prefs/proposals/{id}/accept"
        | "/api/v1/prefs/proposals/{id}/reject";
      unwrap(await client.POST(path, { params: { path: { id } } }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: prefKeys.proposals });
      qc.invalidateQueries({ queryKey: prefKeys.stats });
    },
  });
}

// ── Roles ───────────────────────────────────────────────────────────────────
export const roleKeys = { all: ["roles"] as const };

export function useRoles() {
  return useQuery({
    queryKey: roleKeys.all,
    queryFn: async () => unwrap<Role[]>(await client.GET("/api/v1/roles")),
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; description?: string; permissions: string[] }) =>
      unwrap<Role>(await client.POST("/api/v1/roles", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      unwrap(await client.DELETE("/api/v1/roles/{name}", { params: { path: { name } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

// ── Audit ───────────────────────────────────────────────────────────────────
// The log tail and a single trace lookup are separate namespaces: neither may
// prefix the other, so refreshing one can never cancel the other's fetch.
export const auditKeys = {
  /** Root for invalidation; every filtered list nests under it. */
  logs: ["audit", "logs"] as const,
  list: (filter: AuditFilter) => ["audit", "logs", filter] as const,
  trace: (traceId: string) => ["audit", "trace", traceId] as const,
};

/** Server-side filters `GET /audit/logs` accepts. Empty strings are dropped. */
export interface AuditFilter {
  limit?: number;
  event_type?: string;
  agent_id?: string;
  task_id?: string;
  severity?: string;
  from?: string;
  to?: string;
}

export function useAuditLogs(filter: AuditFilter = {}) {
  const query = Object.fromEntries(
    Object.entries({ limit: 100, ...filter }).filter(([, v]) => v !== "" && v != null),
  ) as AuditFilter;
  return useQuery({
    queryKey: auditKeys.list(query),
    queryFn: async ({ signal }) =>
      unwrap<AuditEntrySummary[]>(
        await client.GET("/api/v1/audit/logs", { params: { query }, signal }),
      ),
    // Keep the previous rows on screen while a new filter loads.
    placeholderData: (prev) => prev,
  });
}

// ── Audit verify + trace lookup ─────────────────────────────────────────────
export interface AuditVerifyResult {
  valid?: boolean;
  entries_checked?: number;
  /** Id gaps left by rotation/cleanup; each starts a fresh chain segment. */
  gaps?: number;
  first_invalid_seq?: number | null;
}
export function useVerifyAudit() {
  return useMutation({
    mutationFn: async () =>
      unwrap<unknown>(await client.GET("/api/v1/audit/verify")) as AuditVerifyResult,
  });
}
export function useAuditTrace(traceId: string) {
  const trimmed = traceId.trim();
  return useQuery({
    queryKey: auditKeys.trace(trimmed),
    queryFn: async () =>
      unwrap<AuditEntryDetail>(
        await client.GET("/api/v1/audit/logs/{trace_id}", {
          params: { path: { trace_id: trimmed } },
        }),
      ),
    enabled: trimmed.length > 0,
    retry: false,
  });
}
