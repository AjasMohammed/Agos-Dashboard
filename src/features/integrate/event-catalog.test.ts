import { describe, expect, it } from "vitest";
import { EVENT_CATALOG_GEN } from "@/realtime/events.gen";
import {
  CURATED,
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
  it("covers every generated category with non-empty event lists", () => {
    // Derived from the generated catalog, not a hardcoded count: the kernel
    // gains categories (ChatEvents, 2026-08-30) and a literal number turns
    // that into a test failure instead of information.
    expect(EVENT_CATALOG).toHaveLength(EVENT_CATALOG_GEN.length);
    for (const c of EVENT_CATALOG) {
      expect(c.events.length).toBeGreaterThan(0);
      expect(c.resource.startsWith("events.")).toBe(true);
    }
  });

  it("matches every curated category to a generated one", () => {
    // A kernel rename drops the curated entry, and the uncurated fallback
    // re-adds the category with a humanized label — the catalog length is
    // unchanged, so only these assertions catch the regressed labels.
    for (const c of CURATED) {
      expect(EVENT_CATALOG_GEN.some((g) => g.value === c.value)).toBe(true);
    }
    const labelByValue = new Map(EVENT_CATALOG.map((c) => [c.value, c.label]));
    for (const c of CURATED) {
      expect(labelByValue.get(c.value)).toBe(c.label);
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

  it("returns a copy, never the shared EVENT_FIELDS array", () => {
    const fields = fieldsForSelection("ToolExecutionFailed");
    fields.push("injected");
    expect(EVENT_FIELDS.ToolExecutionFailed).not.toContain("injected");
  });

  it("returns a copy for a single-event category too", () => {
    // `reduce` with no seed over a one-element list returns that element — the
    // shared EVENT_FIELDS array — which is the only case the category path's
    // spread guards. No generated category has one event today, so shrink one
    // to reach that branch (restored below).
    const cat = EVENT_CATALOG.find((c) => c.value === "ToolEvents");
    if (!cat) throw new Error("ToolEvents category missing");
    const original = cat.events;
    cat.events = ["ToolExecutionFailed"];
    try {
      const fields = fieldsForSelection("category:ToolEvents");
      expect(fields).toEqual(EVENT_FIELDS.ToolExecutionFailed);
      fields.push("injected");
      expect(EVENT_FIELDS.ToolExecutionFailed).not.toContain("injected");
    } finally {
      cat.events = original;
    }
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

  it("does not split on 'and' inside quotes or a list", () => {
    // A wrong split leaves fragments ("b'" / "provider in [a,") that fail the
    // predicate check, so a null here proves the clause stayed whole.
    expect(validateFilter("error contains 'a and b'")).toBeNull();
    expect(validateFilter('error contains "a and b"')).toBeNull();
    expect(validateFilter("provider in [a, and, b]")).toBeNull();
  });

  it("rejects an unterminated quote or list", () => {
    // The kernel tokenizer rejects these; the UI must not report them valid.
    expect(validateFilter("error contains 'timeout")).not.toBeNull();
    expect(validateFilter('error contains "timeout')).not.toBeNull();
    expect(validateFilter("provider in [a, b")).not.toBeNull();
    // The three above are all caught by the `in`-list / predicate checks too;
    // this one only fails if the bracket depth is tracked across clauses.
    expect(validateFilter("tool_name == 'a' and provider in [b")).not.toBeNull();
  });

  it("rejects a stray closing bracket", () => {
    // The kernel returns "unexpected closing bracket", and any parse error
    // compiles to a filter that matches EVERY event — so a duplicated paste
    // must not pass a green form.
    expect(validateFilter("provider in [github, stripe]]")).not.toBeNull();
    expect(validateFilter("a == 1]")).not.toBeNull();
    // Distinct message: a stray "]" is the opposite typo from an unclosed "[".
    expect(validateFilter("a == 1]")).not.toBe(validateFilter("provider in [a, b"));
    // ...but a "]" inside a quoted value is just text.
    expect(validateFilter("error contains 'a]b'")).toBeNull();
  });

  it("rejects an empty item in an 'in' list", () => {
    // The kernel's parse_list_value errors on these → matches every event.
    expect(validateFilter("provider in [a,,b]")).not.toBeNull();
    expect(validateFilter("provider in [a, ]")).not.toBeNull();
    // An empty list is legal (it simply never matches), and a quoted comma is
    // part of the item, not a separator.
    expect(validateFilter("provider in []")).toBeNull();
    expect(validateFilter("provider in ['a,b', c]")).toBeNull();
  });
});
