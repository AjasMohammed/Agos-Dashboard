import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAgents } from "@/api/queries/agents";
import { useTools } from "@/api/queries/tools";
import {
  fetchPipelineDefinition,
  fetchWorkflowDefinition,
  useSavePipeline,
  useSaveWorkflow,
} from "@/api/queries/automation";
import { useTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toastError } from "@/lib/errors";
import {
  DND_TYPE,
  graphToPipeline,
  graphToWorkflow,
  makeNode,
  pipelineToGraph,
  workflowToGraph,
  type BuilderNode,
  type StepData,
} from "./graph";
import { Field, Palette, StepNode, type PaletteItem } from "./parts";

const nodeTypes = { step: StepNode };

type Mode = "workflow" | "pipeline";

const DEFAULT_EDGE_OPTIONS = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { strokeWidth: 1.5 },
};

/** Inspector panel for the currently selected node. */
function Inspector({
  mode,
  node,
  agents,
  tools,
  onChange,
  onDelete,
}: {
  mode: Mode;
  node: BuilderNode;
  agents: string[];
  tools: string[];
  onChange: (patch: Partial<StepData>) => void;
  onDelete: () => void;
}) {
  const d = node.data;
  const structural = d.kind === "start" || d.kind === "end";
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card/40">
      <div className="flex items-center justify-between border-b border-border p-3">
        <p className="text-sm font-semibold capitalize">{d.kind} node</p>
        <Button variant="ghost" size="icon" title="Delete node" onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <Field label={mode === "pipeline" ? "Step name (id)" : "Name"}>
          <Input value={d.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
        {d.kind === "agent" && (
          <>
            <Field label="Agent">
              <Select value={d.agent ?? ""} onChange={(e) => onChange({ agent: e.target.value })}>
                <option value="">Pick an agent…</option>
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={mode === "pipeline" ? "Task prompt ({{input}} and {{var}} interpolate)" : "Task prompt"}>
              <Textarea
                value={d.task ?? ""}
                onChange={(e) => onChange({ task: e.target.value })}
                className="min-h-28 text-xs"
                placeholder="What should this agent do?"
              />
            </Field>
          </>
        )}
        {d.kind === "tool" && (
          <>
            <Field label="Tool">
              <Select value={d.tool ?? ""} onChange={(e) => onChange({ tool: e.target.value, rawType: undefined })}>
                <option value="">Pick a tool…</option>
                {d.rawType && <option value={d.rawType}>{d.rawType} (current)</option>}
                {tools.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Input (JSON)">
              <Textarea
                value={d.input ?? ""}
                onChange={(e) => onChange({ input: e.target.value })}
                className="min-h-28 font-mono text-xs"
                placeholder={'{\n  "param": "value"\n}'}
                spellCheck={false}
              />
            </Field>
          </>
        )}
        {mode === "pipeline" && !structural && (
          <>
            <Field label="Output variable">
              <Input
                value={d.outputVar ?? ""}
                onChange={(e) => onChange({ outputVar: e.target.value })}
                placeholder="defaults to <id>_output"
                className="font-mono"
              />
            </Field>
            <Field label="On failure">
              <Select
                value={d.onFailure ?? "fail"}
                onChange={(e) => onChange({ onFailure: e.target.value as StepData["onFailure"] })}
              >
                <option value="fail">Fail the pipeline</option>
                <option value="skip">Skip and continue</option>
                <option value="use_default">Use a default value</option>
              </Select>
            </Field>
            {d.onFailure === "use_default" && (
              <Field label="Default value">
                <Input
                  value={d.defaultValue ?? ""}
                  onChange={(e) => onChange({ defaultValue: e.target.value })}
                />
              </Field>
            )}
          </>
        )}
        {mode === "workflow" && !structural && (
          <>
            <Field label="Notes">
              <Textarea
                value={d.notes ?? ""}
                onChange={(e) => onChange({ notes: e.target.value })}
                className="min-h-16 text-xs"
              />
            </Field>
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={d.disabled ?? false}
                onChange={(e) => onChange({ disabled: e.target.checked })}
                className="accent-[hsl(var(--primary))]"
              />
              Disabled (skipped at run time)
            </label>
          </>
        )}
      </div>
    </aside>
  );
}

function BuilderCanvas({
  mode,
  editKey,
}: {
  mode: Mode;
  /** Workflow id or pipeline name when editing; undefined when creating. */
  editKey?: string;
}) {
  const navigate = useNavigate();
  const resolved = useTheme((s) => s.resolved);
  const agents = useAgents();
  const tools = useTools();
  const saveWorkflow = useSaveWorkflow();
  const savePipeline = useSavePipeline();
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(
    mode === "workflow" && !editKey
      ? [
          makeNode({ kind: "start", label: "Start" }, { x: 60, y: 140 }),
          makeNode({ kind: "end", label: "End" }, { x: 620, y: 140 }),
        ]
      : [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(Boolean(editKey));
  const originalDoc = useRef<Record<string, unknown>>({});
  // Typed as string: the list routes are registered dynamically from NAV_ITEMS,
  // so they aren't part of the router's literal route union.
  const listPath: string = mode === "workflow" ? "/workflows" : "/pipelines";

  // Seed the canvas from the stored definition when editing.
  useEffect(() => {
    if (!editKey) return;
    const load = mode === "workflow" ? fetchWorkflowDefinition : fetchPipelineDefinition;
    load(editKey)
      .then((doc) => {
        originalDoc.current = doc;
        const graph = mode === "workflow" ? workflowToGraph(doc) : pipelineToGraph(doc);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setName(typeof doc.name === "string" ? doc.name : editKey);
        setDescription(typeof doc.description === "string" ? doc.description : "");
        setOutput(typeof doc.output === "string" ? doc.output : "");
      })
      .catch((err) => {
        toastError(err);
        navigate({ to: listPath });
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey, mode]);

  const onConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge(conn, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (item: PaletteItem, position?: { x: number; y: number }) => {
      const pos = position ?? { x: 120 + Math.random() * 160, y: 120 + Math.random() * 160 };
      setNodes((ns) => [...ns, makeNode(structuredClone(item.data), pos)]);
    },
    [setNodes],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      const raw = e.dataTransfer.getData(DND_TYPE);
      if (!raw) return;
      e.preventDefault();
      const data = JSON.parse(raw) as StepData;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setNodes((ns) => [...ns, makeNode(data, pos)]);
    },
    [screenToFlowPosition, setNodes],
  );

  const palette = useMemo(() => {
    const agentItems: PaletteItem[] = (agents.data ?? []).map((a) => ({
      label: a.name,
      sub: a.model,
      data: { kind: "agent", label: a.name, agent: a.name, task: "" },
    }));
    const toolItems: PaletteItem[] = (tools.data ?? []).map((t) => ({
      label: t.name,
      sub: t.description?.slice(0, 60),
      data: { kind: "tool", label: t.name, tool: t.name, input: "" },
    }));
    const groups = [
      { label: "Agents", items: agentItems },
      { label: "Tools", items: toolItems },
    ];
    if (mode === "workflow") {
      groups.unshift({
        label: "Structure",
        items: [
          { label: "Start", data: { kind: "start", label: "Start" } },
          { label: "End", data: { kind: "end", label: "End" } },
        ],
      });
    }
    return groups;
  }, [agents.data, tools.data, mode]);

  const selected = nodes.find((n) => n.selected);

  const updateSelected = useCallback(
    (patch: Partial<StepData>) => {
      if (!selected) return;
      setNodes((ns) =>
        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
    },
    [selected, setNodes],
  );

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
  }, [selected, setNodes, setEdges]);

  async function onSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(`Give the ${mode} a name first.`);
      return;
    }
    try {
      if (mode === "workflow") {
        const definition = {
          ...originalDoc.current,
          ...graphToWorkflow({ id: editKey, name: trimmed, description, nodes, edges }),
        };
        await saveWorkflow.mutateAsync({ id: editKey, name: trimmed, definition });
      } else {
        const definition: Record<string, unknown> = {
          ...originalDoc.current,
          ...graphToPipeline({ name: trimmed, description, output, nodes, edges }),
        };
        if (!output.trim()) delete definition.output;
        if (!description.trim()) delete definition.description;
        await savePipeline.mutateAsync({ name: trimmed, definition });
      }
      toast.success(editKey ? "Saved" : `${mode === "workflow" ? "Workflow" : "Pipeline"} created`);
      navigate({ to: listPath });
    } catch (err) {
      toastError(err);
    }
  }

  const saving = saveWorkflow.isPending || savePipeline.isPending;

  return (
    <div className="-mx-6 flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Button asChild variant="ghost" size="icon" title="Back">
          <Link to={listPath}>
            <ArrowLeft />
          </Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={mode === "workflow" ? "Workflow name" : "Pipeline name"}
          disabled={mode === "pipeline" && Boolean(editKey)}
          className="h-8 w-56 font-medium"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="h-8 w-72"
        />
        {mode === "pipeline" && (
          <Input
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="Output var (optional)"
            title="Which step output_var is the pipeline's final result"
            className="h-8 w-44 font-mono text-xs"
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge
            {edges.length === 1 ? "" : "s"}
          </span>
          <Button size="sm" onClick={onSave} disabled={saving || loading}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <Palette groups={palette} onAdd={(item) => addNode(item)} />
        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            isValidConnection={(c) => c.source !== c.target}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            colorMode={resolved}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            className="!bg-background"
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-card" />
          </ReactFlow>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-lg border border-dashed border-border px-6 py-4 text-sm text-muted-foreground">
                Drag agents and tools from the palette to build your {mode}.
              </p>
            </div>
          )}
        </div>
        {selected && (
          <Inspector
            mode={mode}
            node={selected}
            agents={(agents.data ?? []).map((a) => a.name)}
            tools={(tools.data ?? []).map((t) => t.name)}
            onChange={updateSelected}
            onDelete={deleteSelected}
          />
        )}
      </div>
    </div>
  );
}

function BuilderPage({ mode, editKey }: { mode: Mode; editKey?: string }) {
  return (
    <ReactFlowProvider>
      <BuilderCanvas mode={mode} editKey={editKey} />
    </ReactFlowProvider>
  );
}

export function WorkflowBuilderPage() {
  const params = useParams({ strict: false }) as { id?: string };
  // Key forces a fresh canvas when switching between /new and /$id/edit.
  return <BuilderPage key={params.id ?? "new"} mode="workflow" editKey={params.id} />;
}

export function PipelineBuilderPage() {
  const params = useParams({ strict: false }) as { name?: string };
  return <BuilderPage key={params.name ?? "new"} mode="pipeline" editKey={params.name} />;
}
