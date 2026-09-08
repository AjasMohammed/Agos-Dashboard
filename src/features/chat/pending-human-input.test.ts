import { describe, expect, it } from "vitest";
import { pendingHumanInput } from "./pending-human-input";
import type { Escalation, NotificationSummary } from "@/api/models";

const esc = (o: Partial<Escalation>): Escalation =>
  ({
    id: 1,
    task_id: "t1",
    agent_id: "a",
    reason: "",
    context_summary: "",
    decision_point: "run rm?",
    options: ["approve", "deny"],
    urgency: "high",
    blocking: true,
    created_at: "",
    expires_at: "",
    resolved: false,
    resolution: null,
    metadata: {},
    ...o,
  }) as Escalation;

const note = (o: Partial<NotificationSummary>): NotificationSummary =>
  ({
    id: "n1",
    subject: "q",
    priority: "normal",
    read: false,
    timestamp: "",
    from: "",
    body: "which one?",
    task_id: "t1",
    needs_response: true,
    ...o,
  }) as NotificationSummary;

describe("pendingHumanInput", () => {
  it("matches only running calls by kernel task id", () => {
    const stream = {
      user: "",
      parts: [
        { kind: "tool" as const, name: "shell-exec", taskId: "t1" },
        { kind: "tool" as const, name: "web-search", taskId: "t0", success: true },
        { kind: "text" as const, text: "some prose between the calls" },
        { kind: "tool" as const, name: "gateway-call" },
      ],
    };
    const out = pendingHumanInput(
      stream,
      [esc({ id: 1 }), esc({ id: 2, task_id: "t0" }), esc({ id: 3, resolved: true })],
      [note({ id: "n1" }), note({ id: "n2", needs_response: false }), note({ id: "n3", task_id: "zz" })],
    );
    expect(out.approvals.map((a) => a.escalation.id)).toEqual([1]);
    expect(out.approvals[0].toolName).toBe("shell-exec");
    expect(out.questions.map((q) => q.id)).toEqual(["n1"]);
  });

  it("refuses to name a tool when the turn has several calls in flight", () => {
    // All calls in one LLM iteration share the turn's task id, so a card cannot
    // say which tool an escalation is for — and "Always allow <tool>" must not
    // grant a tool the user never reviewed.
    const stream = {
      user: "",
      parts: [
        { kind: "tool" as const, name: "shell-exec", taskId: "t1" },
        { kind: "tool" as const, name: "file-writer", taskId: "t1" },
      ],
    };
    const out = pendingHumanInput(stream, [esc({ id: 1 })], []);
    expect(out.approvals).toHaveLength(1);
    expect(out.approvals[0].toolName).toBeUndefined();
  });

  it("is empty with no running calls", () => {
    const out = pendingHumanInput({ user: "", parts: [] }, [esc({})], [note({})]);
    expect(out.approvals).toEqual([]);
    expect(out.questions).toEqual([]);
  });
});
