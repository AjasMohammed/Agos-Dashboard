import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, unwrap } from "../client";
import type { NotificationSummary } from "../models";

export const notificationKeys = {
  all: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
};

export function useNotifications(opts?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: async () =>
      unwrap<NotificationSummary[]>(await client.GET("/api/v1/notifications")),
    ...opts,
  });
}

/** Unread count for the topbar badge; light poll keeps it fresh without WS wiring. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () => {
      // Contract types this as an untyped Value envelope; the handler emits
      // { unread_count } (handlers/notifications.rs).
      const raw = unwrap<unknown>(await client.GET("/api/v1/notifications/unread"));
      const n = (raw as { unread_count?: unknown })?.unread_count;
      return { unread_count: typeof n === "number" ? n : 0 };
    },
    refetchInterval: 30_000,
  });
}

export function useDismissNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await client.DELETE("/api/v1/notifications/{id}", { params: { path: { id } } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useRespondNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; text: string }) => {
      unwrap(
        await client.POST("/api/v1/notifications/{id}/respond", {
          params: { path: { id: vars.id } },
          body: { text: vars.text },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useClearReadNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      unwrap(await client.DELETE("/api/v1/notifications/read"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
