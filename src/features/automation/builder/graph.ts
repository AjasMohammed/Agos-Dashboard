import type { Edge, Node } from "@xyflow/react";

/**
 * Graph model for the pipeline builder, plus converters to and from the
 * engine's `PipelineDefinition` (a DAG of steps where edges are `depends_on`).
 * Steps have no position field, so the builder stashes layout under a top-level
 * `ui.positions` key the engine ignores.
 *
 * The workflow (`WorkflowSpec`) half of this module was deleted: no `/workflows`
 * route is registered (the tab is parked, see `docs/workflows-tab-parked.md`),
 * so it was unreachable — and unvalidated, happily emitting `type: "agent."`
 * for a node with no agent picked.
 */

export type StepKind = "agent" | "tool";

const STEP_KINDS: readonly StepKind[] = ["agent", "tool"];

/** Type guard for untrusted `kind` values (drag payloads, stored documents). */
export function isStepKind(value: unknown): value is StepKind {
  return STEP_KINDS.includes(value as StepKind);
}

/** Drag payload MIME type for palette → canvas drops. */
export const DND_TYPE = "application/x-agentos-node";

/** Fallback when a stored `on_failure` is missing — matches the engine default. */
export type OnFailure = "fail" | "skip" | "use_default";

/**
 * A tool hung off an agent node (n8n-style) instead of sitting on the canvas as
 * its own node. Serializes to a normal pipeline tool step that `depends_on` the
 * agent's step; `pipelineToGraph` folds such steps back onto the agent.
 */
export interface AttachedTool {
  tool: string;
  /** Tool input as JSON text (validated on save). */
  input?: string;
  /** Original step id when loaded from a stored pipeline, so edits round-trip. */
  id?: string;
  outputVar?: string;
  /**
   * Carried through the fold/unfold round trip. Previously dropped on load and
   * re-emitted as `"fail"` on save, so a step deliberately set to `skip` became
   * `fail` the moment someone opened the pipeline to reword a prompt.
   */
  onFailure?: OnFailure;
  defaultValue?: string;
  /** Stored step keys the builder does not model — see `residualKeys`. */
  extra?: Record<string, unknown>;
}

export interface StepData extends Record<string, unknown> {
  kind: StepKind;
  /** Display name; doubles as the step id (slugified). */
  label: string;
  agent?: string;
  task?: string;
  tool?: string;
  /** Tools attached to an agent node — rendered inside the node. */
  tools?: AttachedTool[];
  /** Tool input as JSON text (validated on save). */
  input?: string;
  outputVar?: string;
  onFailure?: OnFailure;
  defaultValue?: string;
  /** Stored step keys the builder does not model — see `residualKeys`. */
  extra?: Record<string, unknown>;
}

export type BuilderNode = Node<StepData>;

let counter = 0;
export function nextNodeId(kind: string): string {
  counter += 1;
  return `${kind}_${Date.now().toString(36)}_${counter}`;
}

export function makeNode(
  data: StepData,
  position: { x: number; y: number },
  id?: string,
): BuilderNode {
  return { id: id ?? nextNodeId(data.kind), type: "step", position, data };
}

function parseJsonObject(text: string | undefined, context: string): Record<string, unknown> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return {};
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new Error(`${context}: parameters must be valid JSON`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: parameters must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** Slugify a label into a step id accepted by the engine. */
export function stepId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "step"
  );
}

/** `on_failure` plus its `default_value` companion, shared by canvas and attached steps. */
function failureFields(
  onFailure: OnFailure | undefined,
  defaultValue: string | undefined,
): { on_failure: OnFailure; default_value?: string } {
  const mode = onFailure ?? "fail";
  return mode === "use_default"
    ? { on_failure: mode, default_value: defaultValue ?? "" }
    : { on_failure: mode };
}

/**
 * Step keys the builder actually models. Everything else a stored step declares
 * — `timeout_minutes`, `retry_on_failure`, `retry_backoff_ms`,
 * `retry_max_delay_ms`, and anything the engine grows later — is carried
 * through opaquely in `extra` rather than dropped, because the round trip is
 * lossy otherwise: a step set to retry 3 times lost its retries the moment
 * someone opened the builder to reword a prompt, and the next transient 503
 * failed the whole run. Same bug class as the `on_failure` one above, so the
 * fix is the general one instead of four more inspector controls.
 */
const MODELLED_STEP_KEYS = new Set([
  "id",
  "agent",
  "task",
  "tool",
  "input",
  "output_var",
  "depends_on",
  "on_failure",
  "default_value",
]);

function residualKeys(step: WireStep): Record<string, unknown> | undefined {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) {
    if (!MODELLED_STEP_KEYS.has(k)) rest[k] = v;
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * Reject dependency cycles before submit. A cyclic pipeline saves fine and only
 * fails at run time with "Circular dependency detected" — and when it is driven
 * by a schedule nobody ever sees that, it just fails on every firing.
 */
function assertAcyclic(steps: { id: string; depends_on: string[] }[]): void {
  const deps = new Map<string, string[]>(steps.map((s) => [s.id, s.depends_on]));
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (id: string): void => {
    const seen = state.get(id);
    if (seen === "done") return;
    if (seen === "open") {
      const from = path.indexOf(id);
      throw new Error(`Circular dependency: ${[...path.slice(from), id].join(" → ")}`);
    }
    state.set(id, "open");
    path.push(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    path.pop();
    state.set(id, "done");
  };
  for (const s of steps) visit(s.id);
}

/** Serialize the canvas to a `PipelineDefinition`. Throws on validation errors. */
export function graphToPipeline(opts: {
  name: string;
  description: string;
  output: string;
  nodes: BuilderNode[];
  edges: Edge[];
  /**
   * Version of the document being edited. Hardcoding `1.0.0` here downgraded a
   * pipeline declaring `2.3.0` on any unrelated edit, because the caller spreads
   * this result over the original document.
   */
  version?: string;
}): Record<string, unknown> {
  const stepNodes = opts.nodes;
  if (stepNodes.length === 0) throw new Error("Add at least one step to the pipeline.");
  // Every node is a step now that the structural start/end kinds are gone with
  // the workflow builder — no filtering pass needed.

  const seen = new Set<string>();
  const take = (base: string) => {
    let id = base;
    while (seen.has(id)) id = `${id}_2`;
    seen.add(id);
    return id;
  };

  const idByNode = new Map<string, string>();
  for (const n of stepNodes) idByNode.set(n.id, take(stepId(n.data.label)));

  const positions: Record<string, [number, number]> = {};
  const steps = stepNodes.flatMap((n) => {
    const id = idByNode.get(n.id)!;
    positions[id] = [Math.round(n.position.x), Math.round(n.position.y)];
    const depends_on = opts.edges
      .filter((e) => e.target === n.id && idByNode.has(e.source))
      .map((e) => idByNode.get(e.source)!);
    if (n.data.kind === "agent" && !n.data.agent) {
      throw new Error(`Step "${n.data.label}": pick an agent.`);
    }
    if (n.data.kind === "agent" && !n.data.task?.trim()) {
      throw new Error(`Step "${n.data.label}": the task prompt is empty.`);
    }
    if (n.data.kind === "tool" && !n.data.tool) {
      throw new Error(`Step "${n.data.label}": pick a tool.`);
    }
    const action =
      n.data.kind === "agent"
        ? { agent: n.data.agent ?? "", task: n.data.task ?? "" }
        : { tool: n.data.tool ?? "", input: parseJsonObject(n.data.input, n.data.label) };
    const step = {
      // Unmodelled stored keys first, so the fields below always win.
      ...n.data.extra,
      id,
      ...action,
      output_var: n.data.outputVar?.trim() || `${id}_output`,
      depends_on,
      ...failureFields(n.data.onFailure, n.data.defaultValue),
    };
    // Tools attached to the agent become steps that depend on it.
    const attachedSteps = (n.data.kind === "agent" ? (n.data.tools ?? []) : []).map((t) => {
      const toolId = take(t.id ?? `${id}_${stepId(t.tool)}`);
      return {
        ...t.extra,
        id: toolId,
        tool: t.tool,
        input: parseJsonObject(t.input, `${n.data.label} → ${t.tool}`),
        output_var: t.outputVar?.trim() || `${toolId}_output`,
        depends_on: [id],
        ...failureFields(t.onFailure, t.defaultValue),
      };
    });
    return [step, ...attachedSteps];
  });

  assertAcyclic(steps);

  return {
    name: opts.name,
    version: opts.version?.trim() || "1.0.0",
    ...(opts.description ? { description: opts.description } : {}),
    steps,
    ...(opts.output.trim() ? { output: opts.output.trim() } : {}),
    // Layout metadata for the builder; serde ignores unknown fields at run time.
    ui: { positions },
  };
}

/** The subset of a stored step the builder understands; the rest rides in `extra`. */
interface WireStep {
  [key: string]: unknown;
  id: string;
  agent?: string;
  task?: string;
  tool?: string;
  input?: unknown;
  output_var?: string;
  depends_on?: string[];
  on_failure?: string;
  default_value?: string;
}

function toOnFailure(value: unknown): OnFailure {
  return value === "skip" || value === "use_default" ? value : "fail";
}

/** Parse a stored pipeline definition back into canvas nodes + edges. */
export function pipelineToGraph(doc: Record<string, unknown>): {
  nodes: BuilderNode[];
  edges: Edge[];
} {
  const rawSteps = (doc.steps ?? []) as WireStep[];
  const ui = (doc.ui ?? {}) as { positions?: Record<string, [number, number]> };

  // Fallback layout: columns by dependency depth, rows within a column.
  const depth = new Map<string, number>();
  const byId = new Map(rawSteps.map((s) => [s.id, s]));
  function depthOf(id: string, trail: Set<string>): number {
    if (depth.has(id)) return depth.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const deps = byId.get(id)?.depends_on ?? [];
    const d = deps.length === 0 ? 0 : Math.max(...deps.map((p) => depthOf(p, trail))) + 1;
    depth.set(id, d);
    return d;
  }
  const rowAt: Record<number, number> = {};

  // Fold leaf tool steps that hang off a single agent step back onto that agent
  // as attached tools, so they render inside the node instead of on the canvas.
  const dependents = new Map<string, number>();
  for (const s of rawSteps) {
    for (const d of s.depends_on ?? []) dependents.set(d, (dependents.get(d) ?? 0) + 1);
  }
  const attachedTo = new Map<string, AttachedTool[]>();
  const folded = new Set<string>();
  for (const s of rawSteps) {
    if (s.tool === undefined) continue;
    const deps = s.depends_on ?? [];
    if (deps.length !== 1 || (dependents.get(s.id) ?? 0) > 0) continue;
    const parent = byId.get(deps[0]);
    if (!parent || parent.tool !== undefined) continue;
    const list = attachedTo.get(parent.id) ?? [];
    list.push({
      tool: s.tool,
      input: s.input != null ? JSON.stringify(s.input, null, 2) : "",
      id: s.id,
      outputVar: s.output_var ?? "",
      onFailure: toOnFailure(s.on_failure),
      defaultValue: s.default_value,
      extra: residualKeys(s),
    });
    attachedTo.set(parent.id, list);
    folded.add(s.id);
  }
  const canvasSteps = rawSteps.filter((s) => !folded.has(s.id));

  const nodes: BuilderNode[] = canvasSteps.map((s) => {
    const data: StepData =
      s.tool !== undefined
        ? {
            kind: "tool",
            label: s.id,
            tool: s.tool,
            input: s.input != null ? JSON.stringify(s.input, null, 2) : "",
          }
        : {
            kind: "agent",
            label: s.id,
            agent: s.agent ?? "",
            task: s.task ?? "",
            tools: attachedTo.get(s.id) ?? [],
          };
    data.outputVar = s.output_var ?? "";
    data.onFailure = toOnFailure(s.on_failure);
    data.defaultValue = s.default_value;
    data.extra = residualKeys(s);
    let position: { x: number; y: number };
    const saved = ui.positions?.[s.id];
    // Stored positions are untrusted (hand-authored YAML goes through Import):
    // a NaN reaches React Flow as `translate(NaNpx, NaNpx)` and breaks fitView.
    if (saved && Number.isFinite(saved[0]) && Number.isFinite(saved[1])) {
      position = { x: saved[0], y: saved[1] };
    } else {
      const d = depthOf(s.id, new Set());
      const row = (rowAt[d] = (rowAt[d] ?? -1) + 1);
      position = { x: 60 + d * 280, y: 60 + row * 140 };
    }
    return makeNode(data, position, `n_${s.id}`);
  });

  const edges: Edge[] = [];
  for (const s of canvasSteps) {
    for (const dep of s.depends_on ?? []) {
      if (folded.has(dep)) continue;
      edges.push({ id: `n_${dep}->n_${s.id}`, source: `n_${dep}`, target: `n_${s.id}` });
    }
  }
  return { nodes, edges };
}
