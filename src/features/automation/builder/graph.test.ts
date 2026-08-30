import { describe, expect, it } from "vitest";
import { graphToPipeline, makeNode, pipelineToGraph } from "./graph";

const agentNode = (id: string, label: string) =>
  makeNode({ kind: "agent", label, agent: label, task: "go" }, { x: 0, y: 0 }, id);

describe("pipeline attached tools", () => {
  it("serializes tools attached to an agent as dependent steps", () => {
    const agent = makeNode(
      {
        kind: "agent",
        label: "Sandae",
        agent: "Sandae",
        task: "check tools",
        tools: [{ tool: "list-tools", input: '{ "q": "{{sandae_output}}" }' }],
      },
      { x: 10, y: 20 },
      "n1",
    );
    const doc = graphToPipeline({
      name: "p",
      description: "",
      output: "",
      nodes: [agent],
      edges: [],
    });
    const steps = doc.steps as Record<string, unknown>[];
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ id: "sandae", agent: "Sandae" });
    expect(steps[1]).toMatchObject({
      id: "sandae_list_tools",
      tool: "list-tools",
      depends_on: ["sandae"],
      input: { q: "{{sandae_output}}" },
    });
  });

  it("folds a leaf tool step back onto its agent node on load", () => {
    const doc = {
      name: "p",
      steps: [
        { id: "sandae", agent: "Sandae", task: "go", depends_on: [] },
        { id: "t1", tool: "list-tools", input: {}, depends_on: ["sandae"] },
      ],
    };
    const { nodes, edges } = pipelineToGraph(doc);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.tools).toEqual([
      { tool: "list-tools", input: "{}", id: "t1", outputVar: "", onFailure: "fail" },
    ]);
    expect(edges).toHaveLength(0);
  });

  it("keeps a tool step on the canvas when something depends on it", () => {
    const doc = {
      name: "p",
      steps: [
        { id: "a", agent: "A", task: "go", depends_on: [] },
        { id: "t", tool: "list-tools", input: {}, depends_on: ["a"] },
        { id: "b", agent: "B", task: "go", depends_on: ["t"] },
      ],
    };
    const { nodes, edges } = pipelineToGraph(doc);
    expect(nodes.map((n) => n.data.label)).toEqual(["a", "t", "b"]);
    expect(edges).toHaveLength(2);
  });
});

describe("pipeline round trip", () => {
  // Regression: the fold used to drop on_failure/default_value from attached
  // tools and re-emit "fail", so opening a pipeline to reword a prompt turned a
  // deliberate `skip` into a run-aborting `fail`.
  it("preserves on_failure and default_value through load → save", () => {
    const doc = {
      name: "p",
      version: "2.3.0",
      steps: [
        { id: "sandae", agent: "Sandae", task: "go", depends_on: [], on_failure: "skip" },
        {
          id: "t1",
          tool: "list-tools",
          input: {},
          depends_on: ["sandae"],
          on_failure: "use_default",
          default_value: "{}",
        },
      ],
    };
    const { nodes, edges } = pipelineToGraph(doc);
    const again = graphToPipeline({
      name: "p",
      description: "",
      output: "",
      nodes,
      edges,
      version: doc.version,
    });
    const steps = again.steps as Record<string, unknown>[];
    expect(steps[0]).toMatchObject({ id: "sandae", on_failure: "skip" });
    expect(steps[1]).toMatchObject({
      id: "t1",
      on_failure: "use_default",
      default_value: "{}",
    });
  });

  // Regression: every step key the builder does not model — the retry knobs and
  // timeout_minutes today, whatever the engine grows tomorrow — used to be
  // dropped on load and never re-emitted, so opening a pipeline to reword a
  // prompt silently disarmed its retries.
  it("carries unmodelled step keys through load → save", () => {
    const doc = {
      name: "p",
      steps: [
        {
          id: "sandae",
          agent: "Sandae",
          task: "go",
          depends_on: [],
          timeout_minutes: 5,
          retry_on_failure: 3,
          retry_backoff_ms: 750,
          retry_max_delay_ms: 20_000,
        },
        {
          id: "t1",
          tool: "list-tools",
          input: {},
          depends_on: ["sandae"],
          retry_on_failure: 2,
          some_future_field: "keep me",
        },
      ],
    };
    const { nodes, edges } = pipelineToGraph(doc);
    const steps = graphToPipeline({
      name: "p",
      description: "",
      output: "",
      nodes,
      edges,
    }).steps as Record<string, unknown>[];
    expect(steps[0]).toMatchObject({
      id: "sandae",
      timeout_minutes: 5,
      retry_on_failure: 3,
      retry_backoff_ms: 750,
      retry_max_delay_ms: 20_000,
    });
    // Including through the attached-tool fold, and for keys this build has
    // never heard of.
    expect(steps[1]).toMatchObject({ retry_on_failure: 2, some_future_field: "keep me" });
    // The modelled fields still win over a stale copy in the residual.
    expect(steps[1].id).toBe("t1");
  });

  it("keeps the document's version instead of stamping 1.0.0", () => {
    const nodes = [agentNode("n1", "alpha")];
    const args = { name: "p", description: "", output: "", nodes, edges: [] };
    expect(graphToPipeline({ ...args, version: "2.3.0" }).version).toBe("2.3.0");
    // Only a brand-new pipeline gets the default.
    expect(graphToPipeline(args).version).toBe("1.0.0");
  });
});

describe("pipeline validation", () => {
  // A cycle used to save fine and only surface as a run-time "Circular
  // dependency detected" — invisible when the pipeline runs from a schedule.
  it("rejects a dependency cycle, naming the steps in it", () => {
    const nodes = [agentNode("n1", "alpha"), agentNode("n2", "beta")];
    const edges = [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n1" },
    ];
    expect(() =>
      graphToPipeline({ name: "p", description: "", output: "", nodes, edges }),
    ).toThrow(/Circular dependency.*alpha.*beta|Circular dependency.*beta.*alpha/);
  });
});

describe("stored layout", () => {
  // Hand-authored YAML arrives through ImportPipelineDialog; a non-finite
  // position reaches React Flow as translate(NaNpx, NaNpx) and breaks fitView.
  it("falls back to the computed layout for non-finite coordinates", () => {
    const doc = {
      name: "p",
      steps: [
        { id: "a", agent: "A", task: "go", depends_on: [] },
        { id: "b", agent: "B", task: "go", depends_on: ["a"] },
      ],
      ui: { positions: { a: [Number.NaN, 5], b: [400, 200] } },
    };
    const { nodes } = pipelineToGraph(doc);
    // `a` is depth 0 / row 0 in the fallback layout; `b` keeps its stored spot.
    expect(nodes[0].position).toEqual({ x: 60, y: 60 });
    expect(nodes[1].position).toEqual({ x: 400, y: 200 });
  });
});
