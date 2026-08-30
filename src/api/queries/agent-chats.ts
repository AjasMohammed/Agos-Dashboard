import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap, unwrapList } from "../client";
import type { ConvoSummary, ConvoDetail } from "../models";

export const convoKeys = {
  all: ["agent-chats"] as const,
  detail: (id: string) => ["agent-chats", id] as const,
};

/**
 * A kernel that dies mid-run leaves its conversation `running` in SQLite with
 * nothing to reconcile it, so "is it running" alone would poll for the life of
 * the tab. Treat a row untouched for this long as abandoned and stop.
 */
const STALE_RUNNING_MS = 10 * 60 * 1000;

function activelyRunning(status: string, updatedAt: string): boolean {
  if (status !== "running") return false;
  const updated = new Date(updatedAt).getTime();
  return Number.isNaN(updated) || Date.now() - updated < STALE_RUNNING_MS;
}

export function useAgentChats() {
  return useQuery({
    queryKey: convoKeys.all,
    queryFn: async () => unwrapList<ConvoSummary>(await client.GET("/api/v1/agent-chats")),
    // Status and updated_at move while a conversation runs; poll until all settle.
    refetchInterval: (q) =>
      q.state.data?.items.some((c) => activelyRunning(c.status, c.updated_at)) ? 5000 : false,
  });
}

export function useAgentChat(id: string | null, poll = true) {
  return useQuery({
    queryKey: convoKeys.detail(id ?? ""),
    queryFn: async () =>
      unwrap<ConvoDetail>(
        await client.GET("/api/v1/agent-chats/{id}", { params: { path: { id: id! } } }),
      ),
    enabled: id != null,
    // A running conversation gains turns; poll only while its dialog is open.
    refetchInterval: (q) =>
      poll && q.state.data && activelyRunning(q.state.data.status, q.state.data.updated_at)
        ? 3000
        : false,
  });
}

export function useCreateAgentChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { topic: string; participants: string[]; max_turns?: number }) =>
      unwrap<ConvoSummary>(await client.POST("/api/v1/agent-chats", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: convoKeys.all }),
  });
}

export function useStopAgentChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.POST("/api/v1/agent-chats/{id}/stop", { params: { path: { id } } }));
    },
    // `all` is the prefix of `detail(id)`, so it already covers the open
    // conversation — a second, narrower call would be redundant.
    onSuccess: () => qc.invalidateQueries({ queryKey: convoKeys.all }),
  });
}
