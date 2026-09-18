import { describe, expect, it } from "vitest";
import { panelRows } from "./notification-rows";
import type { NotificationSummary } from "@/api/models";

const n = (over: Partial<NotificationSummary>): NotificationSummary =>
  ({
    id: "1",
    subject: "s",
    priority: "normal",
    read: false,
    timestamp: "2026-09-18T00:00:00Z",
    ...over,
  }) as NotificationSummary;

describe("panelRows", () => {
  it("drops notifications whose escalation already has an approval card", () => {
    const rows = panelRows(
      [n({ id: "a", escalation_id: 7 }), n({ id: "b" })],
      new Set([7]),
    );
    expect(rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("keeps an escalation row the pending queue no longer has", () => {
    // Resolved or expired: no card is rendered for it, so the plain row is the
    // only trace of it left in the panel.
    const rows = panelRows([n({ id: "a", escalation_id: 7 })], new Set([9]));
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps a blocked question that newer rows would have pushed past the cap", () => {
    const many = Array.from({ length: 12 }, (_, i) => n({ id: String(i) }));
    const rows = panelRows([...many, n({ id: "q", needs_response: true })], new Set());
    expect(rows[0]?.id).toBe("q");
    expect(rows).toHaveLength(8);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => n({ id: String(i) }));
    expect(panelRows(many, new Set())).toHaveLength(8);
  });
});
