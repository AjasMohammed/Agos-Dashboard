import { describe, expect, it } from "vitest";
import { buildActivityFeed, senderAgentId } from "./activity-feed";
import type { Escalation, NotificationSummary, TaskSummary } from "@/api/models";

const task = (o: Partial<TaskSummary>): TaskSummary =>
  ({ id: "t", prompt_preview: "do it", status: "completed", created_at: "2026-01-01T00:00:00Z", ...o }) as TaskSummary;

describe("buildActivityFeed", () => {
  it("merges the three sources newest first", () => {
    const feed = buildActivityFeed(
      [task({ id: "t1", created_at: "2026-01-01T00:00:00Z" })],
      [{ id: 1, decision_point: "run rm?", resolved: false, urgency: "high", created_at: "2026-01-03T00:00:00Z" } as Escalation],
      [{ id: "n1", subject: "done", timestamp: "2026-01-02T00:00:00Z" } as NotificationSummary],
    );
    expect(feed.map((f) => f.kind)).toEqual(["approval", "message", "task"]);
    expect(feed[0].title).toBe("run rm?");
  });

  it("hides resolved approvals and links tasks to their detail route", () => {
    const feed = buildActivityFeed(
      [task({ id: "t9" })],
      [{ id: 2, decision_point: "old", resolved: true, created_at: "2026-01-09T00:00:00Z" } as Escalation],
      [],
    );
    expect(feed).toHaveLength(1);
    expect(feed[0].to).toBe("/tasks/$id");
    expect(feed[0].params).toEqual({ id: "t9" });
  });

  it("prefers completion time over creation time for a finished task", () => {
    const feed = buildActivityFeed(
      [task({ id: "t1", created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-05T00:00:00Z" })],
      [],
      [{ id: "n1", subject: "n", timestamp: "2026-01-03T00:00:00Z" } as NotificationSummary],
    );
    expect(feed[0].kind).toBe("task");
  });
});

describe("senderAgentId", () => {
  const id = "3b6f2a9c-1111-2222-3333-444444444444";
  it("extracts the id from the API's `Agent <uuid>` label or a bare uuid", () => {
    expect(senderAgentId(`Agent ${id}`)).toBe(id);
    expect(senderAgentId(id)).toBe(id);
  });
  it("leaves kernel/system sources alone", () => {
    expect(senderAgentId("Kernel")).toBeNull();
    expect(senderAgentId(undefined)).toBeNull();
  });
});
