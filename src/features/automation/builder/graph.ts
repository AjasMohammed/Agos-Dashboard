import type { Edge, Node } from "@xyflow/react";

/**
 * Graph model shared by the workflow and pipeline builders, plus converters to
 * and from the backend formats:
 *
 * - Workflows: the kernel's n8n-style `WorkflowSpec` (typed nodes with
 *   `position: [x,y]` and a source→port→bucket connection map). Node types
 *   follow the kernel registry conventions: `start`/`end` (structural),
 *   `agent.<name>` (params `{ task }`) and `tool.<name>` (params = tool input).
 * - Pipelines: the engine's `PipelineDefinition` (a DAG of steps where edges
 *   are `depends_on`). Steps have no position field, so the builder stashes
 *   layout under a top-level `ui.positions` key the engine ignores.
 */

export type StepKind = "start" | "end" | "agent" | "tool";

/** Drag payload MIME type for palette → canvas drops. */
export const DND_TYPE = "application/x-agentos-node";

export interface StepData extends Record<string, unknown> {
  kind: StepKind;
  /** Display name; doubles as the step id (slugified) in pipelines. */
  label: string;
  agent?: string;
  task?: string;
  tool?: string;
  /** Tool input / unknown-node parameters as JSON text (validated on save). */
  input?: string;
  outputVar?: string;
  onFailure?: "fail" | "skip" | "use_default";
  defaultValue?: string;
  disabled?: boolean;
  notes?: string;
  /** Original node type for unknown workflow nodes, so they round-trip. */
  rawType?: string;
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

// ── Workflows (WorkflowSpec) ────────────────────────────────────────────────

interface WireConnection {
  node: string;
  type: string;
  index: number;
}
type ConnectionMap = Record<string, Record<string, WireConnection[][]>>;

function workflowNodeType(data: StepData): string {
  if (data.kind === "agent") return `agent.${data.agent ?? ""}`;
  if (data.kind === "tool" && !data.rawType) return `tool.${data.tool ?? ""}`;
  if (data.rawType) return data.rawType;
  return data.kind;
}

function workflowNodeParameters(data: StepData): Record<string, unknown> {
  if (data.kind === "agent") return { task: data.task ?? "" };
  if (data.kind === "start" || data.kind === "end") return {};
  return parseJsonObject(data.input, data.label);
}

/** Serialize the canvas to a `WorkflowSpec`-shaped definition. Throws on invalid JSON params. */
export function graphToWorkflow(opts: {
  id?: string;
  name: string;
  description: string;
  nodes: BuilderNode[];
  edges: Edge[];
}): Record<string, unknown> {
  const nodes = opts.nodes.map((n) => ({
    id: n.id,
    name: n.data.label,
    type: workflowNodeType(n.data),
    type_version: 1,
    position: [Math.round(n.position.x), Math.round(n.position.y)],
    parameters: workflowNodeParameters(n.data),
    disabled: n.data.disabled ?? false,
    ...(n.data.notes ? { notes: n.data.notes } : {}),
  }));
  const connections: ConnectionMap = {};
  for (const e of opts.edges) {
    const ports = (connections[e.source] ??= {});
    const buckets = (ports.main ??= [[]]);
    buckets[0].push({ node: e.target, type: "main", index: 0 });
  }
  return {
    ...(opts.id ? { id: opts.id } : {}),
    name: opts.name,
    version: "1.0.0",
    description: opts.description,
    settings: {},
    nodes,
    connections,
  };
}

interface WireWorkflowNode {
  id: string;
  name?: string;
  type?: string;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  disabled?: boolean;
  notes?: string;
}

/** Parse a stored workflow document back into canvas nodes + edges. */
export function workflowToGraph(doc: Record<string, unknown>): {
  nodes: BuilderNode[];
  edges: Edge[];
} {
  const rawNodes = (doc.nodes ?? []) as WireWorkflowNode[];
  const nodes: BuilderNode[] = rawNodes.map((n, i) => {
    const type = n.type ?? "tool";
    const params = n.parameters ?? {};
    const base: StepData = {
      kind: "tool",
      label: n.name ?? n.id,
      disabled: n.disabled ?? false,
      notes: n.notes,
    };
    if (type === "start" || type === "end") {
      base.kind = type;
    } else if (type.startsWith("agent.")) {
      base.kind = "agent";
      base.agent = type.slice("agent.".length);
      base.task = typeof params.task === "string" ? params.task : "";
    } else if (type.startsWith("tool.")) {
      base.kind = "tool";
      base.tool = type.slice("tool.".length);
      base.input = Object.keys(params).length ? JSON.stringify(params, null, 2) : "";
    } else {
      base.kind = "tool";
      base.rawType = type;
      base.tool = type;
      base.input = Object.keys(params).length ? JSON.stringify(params, null, 2) : "";
    }
    const [x, y] = n.position ?? [i * 260, 80];
    return makeNode(base, { x, y }, n.id);
  });

  const edges: Edge[] = [];
  const connections = (doc.connections ?? {}) as ConnectionMap;
  for (const [source, ports] of Object.entries(connections)) {
    for (const buckets of Object.values(ports ?? {})) {
      for (const bucket of buckets ?? []) {
        for (const conn of bucket ?? []) {
          edges.push({ id: `${source}->${conn.node}`, source, target: conn.node });
        }
      }
    }
  }
  return { nodes, edges };
}

// ── Pipelines (PipelineDefinition) ──────────────────────────────────────────

/** Slugify a label into a step id accepted by the engine. */
export function stepId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "step"
  );
}

/** Serialize the canvas to a `PipelineDefinition`. Throws on validation errors. */
export function graphToPipeline(opts: {
  name: string;
  description: string;
  output: string;
  nodes: BuilderNode[];
  edges: Edge[];
}): Record<string, unknown> {
  const stepNodes = opts.nodes.filter((n) => n.data.kind === "agent" || n.data.kind === "tool");
  if (stepNodes.length === 0) throw new Error("Add at least one step to the pipeline.");

  const idByNode = new Map<string, string>();
  const seen = new Set<string>();
  for (const n of stepNodes) {
    let id = stepId(n.data.label);
    while (seen.has(id)) id = `${id}_2`;
    seen.add(id);
    idByNode.set(n.id, id);
  }

  const positions: Record<string, [number, number]> = {};
  const steps = stepNodes.map((n) => {
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
    return {
      id,
      ...action,
      output_var: n.data.outputVar?.trim() || `${id}_output`,
      depends_on,
      on_failure: n.data.onFailure ?? "fail",
      ...(n.data.onFailure === "use_default" ? { default_value: n.data.defaultValue ?? "" } : {}),
    };
  });

  return {
    name: opts.name,
    version: "1.0.0",
    ...(opts.description ? { description: opts.description } : {}),
    steps,
    ...(opts.output.trim() ? { output: opts.output.trim() } : {}),
    // Layout metadata for the builder; serde ignores unknown fields at run time.
    ui: { positions },
  };
}

interface WireStep {
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

  const nodes: BuilderNode[] = rawSteps.map((s) => {
    const data: StepData =
      s.tool !== undefined
        ? {
            kind: "tool",
            label: s.id,
            tool: s.tool,
            input: s.input != null ? JSON.stringify(s.input, null, 2) : "",
          }
        : { kind: "agent", label: s.id, agent: s.agent ?? "", task: s.task ?? "" };
    data.outputVar = s.output_var ?? "";
    data.onFailure = (s.on_failure as StepData["onFailure"]) ?? "fail";
    data.defaultValue = s.default_value;
    let position: { x: number; y: number };
    const saved = ui.positions?.[s.id];
    if (saved) {
      position = { x: saved[0], y: saved[1] };
    } else {
      const d = depthOf(s.id, new Set());
      const row = (rowAt[d] = (rowAt[d] ?? -1) + 1);
      position = { x: 60 + d * 280, y: 60 + row * 140 };
    }
    return makeNode(data, position, `n_${s.id}`);
  });

  const edges: Edge[] = [];
  for (const s of rawSteps) {
    for (const dep of s.depends_on ?? []) {
      edges.push({ id: `n_${dep}->n_${s.id}`, source: `n_${dep}`, target: `n_${s.id}` });
    }
  }
  return { nodes, edges };
}
