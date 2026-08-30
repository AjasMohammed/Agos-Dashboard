import { describe, expect, it } from "vitest";
import { grantWarning, optionLabel, optionVariant, splitByOption } from "./govern-pages";
import type { Escalation } from "@/api/models";

const esc = (id: number, options: string[]): Escalation =>
  ({
    id,
    task_id: "t1",
    agent_id: "a",
    reason: "",
    context_summary: "",
    decision_point: "run rm?",
    options,
    urgency: "high",
    blocking: true,
    created_at: "",
    expires_at: "",
    resolved: false,
    resolution: null,
    metadata: {},
  }) as Escalation;

describe("optionVariant", () => {
  it("styles known negatives as destructive, case/space insensitively", () => {
    for (const opt of ["deny", "Reject", " BLOCK ", "cancel", "abort", "no"]) {
      expect(optionVariant(opt)).toBe("destructive");
    }
  });

  it("styles known affirmatives as the primary action", () => {
    for (const opt of ["approve", "Allow", "accept", "yes"]) {
      expect(optionVariant(opt)).toBe("default");
    }
  });

  it("never renders an unrecognised (agent-authored) option as affirmative", () => {
    // `options` is a free-form Vec<String> from whoever raised the escalation.
    for (const opt of ["wipe-workspace", "retry", "escalate", ""]) {
      expect(optionVariant(opt)).toBe("outline");
    }
  });
});

describe("optionLabel", () => {
  it("capitalises the visible (and accessible) button text without touching the wire value", () => {
    expect(optionLabel("approve")).toBe("Approve");
    expect(optionLabel(" deny ")).toBe("Deny");
    expect(optionLabel("Allow")).toBe("Allow");
  });
});

describe("splitByOption", () => {
  const items = [
    esc(1, ["approve", "deny"]),
    esc(2, ["allow", "block"]), // different verbs — must not be silently skipped
    esc(3, ["approve", "deny"]),
  ];
  const selected = new Set(["1", "2", "3"]);

  it("separates the escalations that offer the decision from those that don't", () => {
    const { targets, skipped } = splitByOption(items, selected, "approve");
    expect(targets.map((e) => e.id)).toEqual([1, 3]);
    expect(skipped.map((e) => e.id)).toEqual([2]);
  });

  it("ignores rows that are not selected", () => {
    const { targets, skipped } = splitByOption(items, new Set(["2"]), "approve");
    expect(targets).toHaveLength(0);
    expect(skipped.map((e) => e.id)).toEqual([2]);
  });
});

describe("grantWarning", () => {
  it("is silent for an agent-scoped, expiring grant", () => {
    expect(grantWarning("shell-exec", false, false)).toBeNull();
  });

  it("warns when the grant applies to every agent", () => {
    expect(grantWarning("shell-exec", true, false)).toContain("every agent");
  });

  it("warns when the grant never expires", () => {
    const w = grantWarning("shell-exec", false, true);
    expect(w).toContain("shell-exec");
    expect(w).toContain("forever");
  });

  it("warns about both at once", () => {
    const w = grantWarning("shell-exec", true, true);
    expect(w).toContain("every agent");
    expect(w).toContain("forever");
  });
});
