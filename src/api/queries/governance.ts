import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import type {
  Escalation,
  PrefProposal,
  ProposalStats,
  Role,
  AuditEntrySummary,
  AuditEntryDetail,
  ApprovalPolicy,
  AddApprovalPolicyBody,
} from "../models";

// ── Escalations ─────────────────────────────────────────────────────────────
export const escalationKeys = { all: ["escalations"] as const };

export function useEscalations(opts?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery({
    queryKey: escalationKeys.all,
    queryFn: async () => unwrap<Escalation[]>(await client.GET("/api/v1/escalations")),
    // The kernel auto-denies a pending escalation after 5 min, so a queue left
    // open on screen has to refresh itself — otherwise the operator approves a
    // row the kernel already denied. `opts` may still override.
    refetchInterval: 5000,
    ...opts,
  });
}

export function useResolveEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; decision: string; note?: string }) => {
      unwrap(
        await client.POST("/api/v1/escalations/{id}/resolve", {
          params: { path: { id: Number(vars.id) } },
          body: { decision: vars.decision, note: vars.note },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: escalationKeys.all }),
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
  logs: ["audit", "logs"] as const,
  trace: (traceId: string) => ["audit", "trace", traceId] as const,
};
export function useAuditLogs() {
  return useQuery({
    queryKey: auditKeys.logs,
    queryFn: async () =>
      unwrap<AuditEntrySummary[]>(
        await client.GET("/api/v1/audit/logs", { params: { query: { limit: 100 } } }),
      ),
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
