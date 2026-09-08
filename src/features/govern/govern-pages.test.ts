import { describe, expect, it } from "vitest";
import {
  buildWorkspaceGrantBody,
  folderGrantWarning,
  normalizeGrantPath,
  grantWarning,
  modeLabel,
  optionLabel,
  optionVariant,
  splitByOption,
} from "./govern-pages";
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

describe("folderGrantWarning", () => {
  it("stays silent for a narrow, agent-scoped project folder", () => {
    expect(folderGrantWarning("/home/ajas/project", false, "rw")).toBeNull();
  });

  it("stays silent for ordinary shared directories the CLI grants without a prompt", () => {
    for (const p of ["/tmp/work", "/srv/data", "/opt/scratch", "/mnt/media"]) {
      expect(folderGrantWarning(p, false, "rw")).toBeNull();
    }
  });

  it("warns on a home-level folder even when scoped to one agent", () => {
    expect(folderGrantWarning("/home/ajas/Desktop/", false, "rw")).toContain("Desktop");
  });

  it("warns on the home directory itself and on a filesystem root", () => {
    expect(folderGrantWarning("/home/ajas", false, "rw")).toContain("everything under");
    expect(folderGrantWarning("/", false, "rw")).toContain("everything under");
  });

  it("classifies the path the kernel will store, not the one that was typed", () => {
    // `lexically_normalize` pops `..` and drops `.` BEFORE the kernel's own `..`
    // check runs, so these all end up as a whole-home grant. Judging the typed
    // string let them through with no warning at all.
    expect(folderGrantWarning("/home/ajas/.", false, "rw")).toContain("everything under /home/ajas");
    expect(folderGrantWarning("/home/ajas/Desktop/..", false, "rw")).toContain(
      "everything under /home/ajas",
    );
    expect(folderGrantWarning("/home/ajas/./Desktop", false, "rw")).toContain("Desktop");
    expect(folderGrantWarning("/home//ajas//Desktop/./", false, "rw")).toContain("Desktop");
  });

  it("recognises home directories that are not /home/<user>", () => {
    // rpm-ostree/Silverblue, NFS sites, macOS — a segment count alone missed
    // every one of these while the CLI, which resolves $HOME, prompts.
    expect(folderGrantWarning("/var/home/ajas/Desktop", false, "rw")).toContain("Desktop");
    expect(folderGrantWarning("/export/home/ajas", false, "rw")).toContain("everything under");
    expect(folderGrantWarning("/Users/ajas/Documents", false, "rw")).toContain("Documents");
  });

  it("states the mode that was actually picked", () => {
    const ro = folderGrantWarning("/home/ajas", false, "r");
    expect(ro).toContain("able to read everything");
    expect(ro).not.toContain("write");
    expect(folderGrantWarning("/home/ajas", false, "rw")).toContain("read and write");
    expect(folderGrantWarning("/home/ajas", false, "rwx")).toContain("read, write and run");
  });

  it("warns whenever the grant covers every agent, however narrow the path", () => {
    const w = folderGrantWarning("/home/ajas/project", true, "rwx");
    expect(w).toContain("Every agent");
    expect(w).toContain("run");
  });
});

describe("buildWorkspaceGrantBody", () => {
  it("drops the all-agents sentinel instead of sending it as an agent name", () => {
    expect(buildWorkspaceGrantBody(" /srv/data/ ", "r", "*")).toEqual({
      path: "/srv/data",
      mode: "r",
      agent_name: undefined,
    });
  });

  it("passes a real agent id through", () => {
    expect(buildWorkspaceGrantBody("/srv/data", "rwx", "agent-uuid").agent_name).toBe("agent-uuid");
  });
});

describe("normalizeGrantPath", () => {
  it("matches the kernel's lexical normalization", () => {
    expect(normalizeGrantPath("/home/ajas/project/")).toBe("/home/ajas/project");
    expect(normalizeGrantPath("/home//ajas/./project")).toBe("/home/ajas/project");
    expect(normalizeGrantPath("/home/ajas/project/..")).toBe("/home/ajas");
  });
});

describe("modeLabel", () => {
  it("spells out the bits", () => {
    expect(modeLabel("rwx")).toBe("read + write + run");
    expect(modeLabel("r")).toBe("read");
    expect(modeLabel("")).toBe("no access");
  });
});
