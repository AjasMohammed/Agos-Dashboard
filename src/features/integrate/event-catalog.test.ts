import { describe, expect, it } from "vitest";
import { EVENT_CATALOG, requiredResourcesFor, humanizeEvent } from "./event-catalog";

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

  it("humanizes PascalCase event names, keeping acronyms intact", () => {
    expect(humanizeEvent("TaskCompleted")).toBe("Task Completed");
    expect(humanizeEvent("DiskSpaceLow")).toBe("Disk Space Low");
    expect(humanizeEvent("CPUSpikeDetected")).toBe("CPU Spike Detected");
    expect(humanizeEvent("GPUMemoryPressure")).toBe("GPU Memory Pressure");
    expect(humanizeEvent("ExternalAPIEvent")).toBe("External API Event");
  });
});
