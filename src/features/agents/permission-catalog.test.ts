import { describe, expect, it } from "vitest";
import type { Role, ToolSummary } from "@/api/models";
import {
  grantedBits,
  groupCatalog,
  groupOf,
  isGranted,
  missingBits,
  parsePermission,
  permissionCatalog,
  resourceHint,
} from "./permission-catalog";
import { KNOWN_PERMISSIONS } from "./permission-catalog.gen";

const tool = (name: string, permissions: string[]) =>
  ({ id: name, name, version: "1", description: "", author: "", trust_tier: "core", status: "installed", permissions }) as ToolSummary;
const role = (name: string, permissions: string[]) =>
  ({ name, description: "", permissions, created_at: "" }) as Role;

describe("parsePermission", () => {
  it("splits on the last colon so path resources survive", () => {
    expect(parsePermission("fs:/data/:rw")).toEqual({ resource: "fs:/data/", bits: "rw" });
  });
  it("canonicalises bit order", () => {
    expect(parsePermission("memory.semantic:qr")).toEqual({ resource: "memory.semantic", bits: "rq" });
  });
  it("rejects what the kernel rejects", () => {
    for (const bad of ["fs.user_data", ":rw", "fs.user_data:", "fs.user_data:rz"]) {
      expect(parsePermission(bad)).toBeNull();
    }
  });
});

describe("permissionCatalog", () => {
  it("unions bits per resource and records every source", () => {
    const catalog = permissionCatalog(
      [tool("shell", ["process.exec:x", "fs.user_data:r"]), tool("notes", ["fs.user_data:w", "bogus"])],
      [role("analyst", ["fs.user_data:r", "memory.semantic:rq"])],
    );
    const fs = catalog.find((e) => e.resource === "fs.user_data");
    expect(fs?.bits).toContain("r");
    expect(fs?.bits).toContain("w");
    expect(fs?.tools).toEqual(expect.arrayContaining(["shell", "notes"]));
    expect(fs?.roles).toEqual(["analyst"]);
    // A role-only resource still appears even though no tool declares it.
    expect(catalog.find((e) => e.resource === "memory.semantic")?.roles).toEqual(["analyst"]);
  });

  it("offers every resource the shipped tools can ask for, not just installed ones", () => {
    const catalog = permissionCatalog([], []);
    expect(catalog.length).toBe(KNOWN_PERMISSIONS.length);
    expect(catalog.map((e) => e.resource)).toContain("hardware.webcam.capture");
  });

  it("is sorted by resource", () => {
    const resources = permissionCatalog([], []).map((e) => e.resource);
    expect(resources).toEqual([...resources].sort((a, b) => a.localeCompare(b)));
  });
});

describe("grouping", () => {
  it("maps a resource prefix to a section, falling back to the prefix itself", () => {
    expect(groupOf("fs.user_data")).toBe("Filesystem");
    expect(groupOf("net.http")).toBe("Network");
    expect(groupOf("network.outbound")).toBe("Network");
    expect(groupOf("fs:/data/")).toBe("Filesystem");
    expect(groupOf("quantum.foo")).toBe("Quantum");
  });

  it("buckets entries under alphabetical sections", () => {
    const groups = groupCatalog(
      permissionCatalog([tool("t", ["net.http:x", "fs.user_data:r", "memory.semantic:r"])], []),
    );
    const names = groups.map((g) => g.group);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(groups.find((g) => g.group === "Network")?.entries.map((e) => e.resource)).toContain(
      "net.http",
    );
  });
});

describe("missingBits", () => {
  const held = grantedBits(["fs.user_data:r"]);
  it("returns only what the agent lacks, so granted rows drop out", () => {
    expect(missingBits(held, "fs.user_data", "rw")).toBe("w");
    expect(missingBits(held, "fs.user_data", "r")).toBe("");
    expect(missingBits(held, "process.exec", "x")).toBe("x");
  });
});

describe("isGranted", () => {
  const granted = grantedBits(["fs.user_data:rw", "junk"]);
  it("is true only when every requested bit is held", () => {
    expect(isGranted(granted, "fs.user_data", "r")).toBe(true);
    expect(isGranted(granted, "fs.user_data", "rw")).toBe(true);
    expect(isGranted(granted, "fs.user_data", "rx")).toBe(false);
    expect(isGranted(granted, "process.exec", "x")).toBe(false);
  });
});

describe("resourceHint", () => {
  it("describes every catalogued resource", () => {
    const undescribed = KNOWN_PERMISSIONS.filter((k) => resourceHint(k.resource) === "");
    expect(undescribed.map((k) => k.resource)).toEqual([]);
  });

  it("falls back to the family for a hand-typed resource", () => {
    expect(resourceHint("fs:/data/")).toBe("Files under this path or namespace.");
    expect(resourceHint("unknown.thing")).toBe("");
  });
});
