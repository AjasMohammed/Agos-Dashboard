import { describe, expect, it } from "vitest";
import {
  EVENT_CATALOG,
  EVENT_FIELDS,
  requiredResourcesFor,
  humanizeEvent,
  fieldsForSelection,
  isExactSelection,
  prettifyFilter,
  prettifyThrottle,
  validateFilter,
  payloadSkeleton,
} from "./event-catalog";

describe("event-catalog", () => {
  it("covers all 10 categories with non-empty event lists", () => {
    expect(EVENT_CATALOG).toHaveLength(10);
    for (const c of EVENT_CATALOG) {
      expect(c.events.length).toBeGreaterThan(0);
      expect(c.resource.startsWith("events.")).toBe(true);
    }
  });

  it("resolves required resources for all / category / exact selections", () => {
    // "all" needs every category resource.
    expect(requiredResourcesFor("all").sort()).toEqual(
      EVENT_CATALOG.map((c) => c.resource).sort(),
    );
    // A category selection needs just that category's resource.
    expect(requiredResourcesFor("category:SecurityEvents")).toEqual(["events.security"]);
    // A bare event type resolves to its owning category's resource.
    expect(requiredResourcesFor("DiskSpaceLow")).toEqual(["events.system_health"]);
    expect(requiredResourcesFor("TaskCompleted")).toEqual(["events.task_lifecycle"]);
    // Unknown selection → no required resources (no spurious grant).
    expect(requiredResourcesFor("NotAReal Event")).toEqual([]);
    expect(requiredResourcesFor("category:Bogus")).toEqual([]);
  });

  it("only maps fields for catalog events (no stray keys)", () => {
    const known = new Set(EVENT_CATALOG.flatMap((c) => c.events));
    for (const ev of Object.keys(EVENT_FIELDS)) {
      expect(known.has(ev)).toBe(true);
    }
  });

  it("suggests fields per selection", () => {
    // Exact event → its own fields.
    expect(fieldsForSelection("ToolExecutionFailed")).toContain("tool_name");
    // Category → fields common to every event in it (all ToolEvents share tool_name).
    expect(fieldsForSelection("category:ToolEvents")).toEqual(["tool_name"]);
    // "all" → nothing reliable.
    expect(fieldsForSelection("all")).toEqual([]);
    // A category whose events aren't all mapped → empty (no over-promising).
    expect(fieldsForSelection("category:ExternalEvents")).toEqual([]);
  });

  it("builds a JSON payload skeleton from an event's fields", () => {
    const skel = payloadSkeleton("ToolExecutionFailed");
    const parsed = JSON.parse(skel);
    expect(Object.keys(parsed)).toEqual(EVENT_FIELDS.ToolExecutionFailed);
    expect(parsed.tool_name).toBe("");
    // Events with no mapped fields → empty object.
    expect(payloadSkeleton("ExternalAPIEvent")).toBe("{}");
  });

  it("classifies exact vs category/all selections", () => {
    expect(isExactSelection("TaskCompleted")).toBe(true);
    expect(isExactSelection("category:ToolEvents")).toBe(false);
    expect(isExactSelection("all")).toBe(false);
  });

  it("humanizes PascalCase event names, keeping acronyms intact", () => {
    expect(humanizeEvent("TaskCompleted")).toBe("Task Completed");
    expect(humanizeEvent("DiskSpaceLow")).toBe("Disk Space Low");
    expect(humanizeEvent("CPUSpikeDetected")).toBe("CPU Spike Detected");
    expect(humanizeEvent("GPUMemoryPressure")).toBe("GPU Memory Pressure");
    expect(humanizeEvent("ExternalAPIEvent")).toBe("External API Event");
  });

  it("prettifies debug-rendered filter strings", () => {
    expect(prettifyFilter("All")).toBe("All events");
    expect(prettifyFilter("Category(SecurityEvents)")).toBe("Any security event");
    expect(prettifyFilter("Exact(DiskSpaceLow)")).toBe("Disk Space Low");
    // Unknown shape passes through unchanged.
    expect(prettifyFilter("Weird")).toBe("Weird");
  });

  it("prettifies debug-rendered throttle strings", () => {
    expect(prettifyThrottle("None")).toBe("—");
    expect(prettifyThrottle("MaxOncePerDuration(300s)")).toBe("Once per 5m");
    expect(prettifyThrottle("MaxOncePerDuration(30s)")).toBe("Once per 30s");
    expect(prettifyThrottle("MaxCountPerDuration(5, 3600s)")).toBe("Max 5 per 1h");
  });

  it("validates payload filters like the kernel grammar", () => {
    // Valid: empty (optional), single, and 'and'-joined predicates.
    expect(validateFilter("")).toBeNull();
    expect(validateFilter("tool_name == shell")).toBeNull();
    expect(validateFilter("cpu_percent >= 90 and threshold < 100")).toBeNull();
    expect(validateFilter("provider in [github, stripe]")).toBeNull();
    expect(validateFilter("error contains 'timeout'")).toBeNull();
    // Invalid: missing operator, non-numeric comparison, bad 'in' list, stray 'and'.
    expect(validateFilter("severity critical")).not.toBeNull();
    expect(validateFilter("cpu_percent > high")).not.toBeNull();
    expect(validateFilter("provider in github")).not.toBeNull();
    expect(validateFilter("tool_name == shell and")).not.toBeNull();
    expect(validateFilter("error contains 90")).not.toBeNull();
    // A field/value containing the letters "and" must not be split.
    expect(validateFilter("command == ls")).toBeNull();
    expect(validateFilter("brand == nike")).toBeNull();
  });
});
