import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
import { ArrowLeft, Loader2, Save, Trash2, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { useAgents } from "@/api/queries/agents";
import { useTools } from "@/api/queries/tools";
import { ApiError } from "@/api/client";
import { fetchPipelineDefinition, useSavePipeline } from "@/api/queries/automation";
import { useTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import {
  DND_TYPE,
  graphToPipeline,
  isStepKind,
  makeNode,
  pipelineToGraph,
  type AttachedTool,
  type BuilderNode,
  type StepData,
} from "./graph";
import { Field, Palette, StepNode, type PaletteItem } from "./parts";

const nodeTypes = { step: StepNode };

// Typed as string: the list routes are registered dynamically from NAV_ITEMS,
// so they aren't part of the router's literal route union.
const LIST_PATH: string = "/pipelines";

const DEFAULT_EDGE_OPTIONS = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { strokeWidth: 1.5 },
};

/** Arrow-key nudge, in flow units. Shift multiplies it — see `onNodeKeyDown`. */
const NUDGE = 10;
const NUDGE_FACTOR = 5;
const ARROW_DIRS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Focus ring for the React Flow-owned node wrapper. It goes on the node's own
 * `className` (React Flow puts it on the focusable div) rather than a
 * `[&_.react-flow__node]` variant on the canvas — Tailwind reads `_` inside an
 * arbitrary variant as a space, so that selector silently compiles to nothing.
 */
const NODE_A11Y_CLASSES =
  "rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Keyboard shortcuts, shown on the canvas so the mouse-free path is discoverable. */
const SHORTCUTS: [string, string][] = [
  ["Tab", "move between nodes"],
  ["↑ ↓ ← →", `nudge ${NUDGE}px (Shift: ${NUDGE * NUDGE_FACTOR}px)`],
  ["Enter / Space", "select — opens the inspector"],
  ["c then c", "connect: press c on the source, then c on the target"],
  ["Delete", "remove the node"],
  ["Esc", "deselect / cancel connecting"],
];

function ShortcutLegend({ connecting }: { connecting: string | null }) {
  return (
    <div className="absolute right-2 top-2 z-10 max-w-64 space-y-1 text-right">
      {connecting && (
        // aria-live so a screen reader hears the armed connection, which is
        // otherwise only visible as a ring on the source node.
        <p
          role="status"
          className="rounded-md border border-primary/50 bg-card px-2 py-1 text-left text-[11px] text-foreground shadow-card"
        >
          Connecting from <span className="font-medium">{connecting}</span> — focus the target node
          and press c again (Esc cancels).
        </p>
      )}
      <details className="inline-block rounded-md border border-border bg-card/90 px-2 py-1 text-left text-[11px] text-muted-foreground shadow-card">
        <summary className="cursor-pointer select-none">Keyboard shortcuts</summary>
        <dl className="mt-1 space-y-0.5">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex gap-2">
              <dt className="w-24 shrink-0 font-mono text-[10px] text-foreground">{keys}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

interface Draft {
  name: string;
  description: string;
  output: string;
  nodes: BuilderNode[];
  edges: Edge[];
}

/**
 * Everything a save would persist, as a comparable string. The dirty guard
 * compares this against the loaded/last-saved document rather than tracking a
 * "touched" flag, so typing a character and deleting it again is not dirty —
 * and so moving a node (which *is* persisted, in `ui.positions`) is.
 *
 * ponytail: re-stringified on every drag frame. Trivial for the graph sizes a
 * human builds; memoise per-slice if a few hundred nodes ever show up.
 */
function snapshot(d: Draft): string {
  return JSON.stringify({
    name: d.name,
    description: d.description,
    output: d.output,
    nodes: d.nodes.map((n) => [n.id, Math.round(n.position.x), Math.round(n.position.y), n.data]),
    edges: d.edges.map((e) => `${e.source}->${e.target}`).sort(),
  });
}

const EMPTY_SNAPSHOT = snapshot({ name: "", description: "", output: "", nodes: [], edges: [] });

/**
 * Tools attached to an agent node (n8n-style): they live inside the node rather
 * than on the canvas, and serialize to tool steps that depend on the agent step.
 */
function AttachedTools({
  tools,
  available,
  onChange,
}: {
  tools: AttachedTool[];
  available: string[];
  onChange: (patch: Partial<StepData>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Tools</p>
      {tools.length === 0 && (
        <p className="text-[11px] text-muted-foreground/70">
          Nothing attached. Attached tools run after this agent, with its output available as{" "}
          <code className="font-mono">{"{{var}}"}</code>.
        </p>
      )}
      {tools.map((t, i) => (
        <div
          key={t.id ?? `${t.tool}-${i}`}
          className="space-y-1 rounded-md border border-border p-2"
        >
          <div className="flex items-center gap-1.5">
            <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{t.tool}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="Detach tool"
              onClick={() => onChange({ tools: tools.filter((_, j) => j !== i) })}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <Textarea
            value={t.input ?? ""}
            onChange={(e) =>
              onChange({
                tools: tools.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)),
              })
            }
            className="min-h-14 font-mono text-[11px]"
            placeholder='{ "param": "value" }'
            spellCheck={false}
          />
        </div>
      ))}
      <Select
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          onChange({ tools: [...tools, { tool: e.target.value, input: "" }] });
        }}
      >
        <option value="">Attach a tool…</option>
        {available
          .filter((name) => !tools.some((t) => t.tool === name))
          .map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
      </Select>
    </div>
  );
}

/** Inspector panel for the currently selected node. */
function Inspector({
  node,
  selectedCount,
  agents,
  tools,
  onChange,
  onDelete,
}: {
  node: BuilderNode;
  /** How many nodes the delete button will remove — it acts on the whole selection. */
  selectedCount: number;
  agents: string[];
  tools: string[];
  onChange: (patch: Partial<StepData>) => void;
  onDelete: () => void;
}) {
  const d = node.data;
  const deleteLabel = selectedCount > 1 ? `Delete ${selectedCount} nodes` : "Delete node";
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card/40">
      <div className="flex items-center justify-between border-b border-border p-3">
        <p className="text-sm font-semibold capitalize">
          {d.kind} node
          {selectedCount > 1 && (
            <span className="ml-1 font-normal text-muted-foreground">
              (+{selectedCount - 1} selected)
            </span>
          )}
        </p>
        <Button variant="ghost" size="icon" title={deleteLabel} onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <Field label="Step name (id)">
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
            <Field label="Task prompt ({{input}} and {{var}} interpolate)">
              <Textarea
                value={d.task ?? ""}
                onChange={(e) => onChange({ task: e.target.value })}
                className="min-h-28 text-xs"
                placeholder="What should this agent do?"
              />
            </Field>
            <AttachedTools tools={d.tools ?? []} available={tools} onChange={onChange} />
          </>
        )}
        {d.kind === "tool" && (
          <>
            <Field label="Tool">
              <Select value={d.tool ?? ""} onChange={(e) => onChange({ tool: e.target.value })}>
                <option value="">Pick a tool…</option>
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
      </div>
    </aside>
  );
}

function BuilderCanvas({ editKey }: { editKey?: string }) {
  const navigate = useNavigate();
  const resolved = useTheme((s) => s.resolved);
  const agents = useAgents();
  const tools = useTools();
  const savePipeline = useSavePipeline();
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(Boolean(editKey));
  // Keyboard connect: `c` on the source node arms this, `c` on a target lands it.
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const originalDoc = useRef<Record<string, unknown>>({});

  // Unsaved-work guard. `baseline` is the document as loaded (or as last saved);
  // anything else on the canvas is unsaved work, and the route is remounted on
  // every entry (`key={params.name ?? "new"}`), so a silent navigation away is
  // unrecoverable.
  const [baseline, setBaseline] = useState(EMPTY_SNAPSHOT);
  const current = useMemo(
    () => snapshot({ name, description, output, nodes, edges }),
    [name, description, output, nodes, edges],
  );
  const dirty = current !== baseline;
  useDirtyGuard(dirty);

  // Set once the save succeeds. `useBlocker` only tears its history block down
  // in an effect, so navigating in the same tick that clears the baseline would
  // still prompt "discard your changes?" — wait for the render where it is gone.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    // The baseline and this flag are set together, so this runs on the render
    // right after the save. Still dirty means the canvas was edited while the
    // request was in flight: stay put, and disarm rather than leaving the flag
    // latched to fire on whichever later edit happens to match the baseline.
    if (dirty) setLeaving(false);
    else navigate({ to: LIST_PATH });
  }, [leaving, dirty, navigate]);

  // Seed the canvas from the stored definition when editing.
  useEffect(() => {
    if (!editKey) return;
    fetchPipelineDefinition(editKey)
      .then((doc) => {
        originalDoc.current = doc;
        const graph = pipelineToGraph(doc);
        const loaded: Draft = {
          name: typeof doc.name === "string" ? doc.name : editKey,
          description: typeof doc.description === "string" ? doc.description : "",
          output: typeof doc.output === "string" ? doc.output : "",
          nodes: graph.nodes,
          edges: graph.edges,
        };
        setNodes(loaded.nodes);
        setEdges(loaded.edges);
        setName(loaded.name);
        setDescription(loaded.description);
        setOutput(loaded.output);
        setBaseline(snapshot(loaded));
      })
      .catch((err) => {
        toastError(err);
        navigate({ to: LIST_PATH });
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey]);

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
      // A throw here escapes the React event handler up to the error boundary,
      // which unmounts the canvas and loses the whole graph — so a malformed
      // payload has to be handled, not trusted.
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        toast.error("Could not read the dropped item.");
        return;
      }
      const step = data as StepData;
      if (!step || !isStepKind(step.kind)) {
        toast.error("That item can't be dropped on the canvas.");
        return;
      }
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setNodes((ns) => [...ns, makeNode(step, pos)]);
    },
    [screenToFlowPosition, setNodes],
  );

  // Pipelines attach tools to an agent node (see AttachedTools) rather than
  // dropping them on the canvas, so the palette offers agents only.
  const palette = useMemo(
    () => [
      {
        label: "Agents",
        items: (agents.data ?? []).map(
          (a): PaletteItem => ({
            label: a.name,
            sub: a.model,
            data: { kind: "agent", label: a.name, agent: a.name, task: "" },
          }),
        ),
      },
    ],
    [agents.data],
  );

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selected = selectedNodes[0];

  const updateSelected = useCallback(
    (patch: Partial<StepData>) => {
      if (!selected) return;
      setNodes((ns) =>
        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
    },
    [selected, setNodes],
  );

  const deleteNodes = useCallback(
    (nodeIds: string[]) => {
      const ids = new Set(nodeIds);
      if (ids.size === 0) return;
      setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
      setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
      setConnectFrom((from) => (from && ids.has(from) ? null : from));
    },
    [setNodes, setEdges],
  );

  // Matches the Delete key, which React Flow applies to the whole selection —
  // the inspector button used to silently drop only the first selected node.
  const deleteSelected = useCallback(
    () => deleteNodes(selectedNodes.map((n) => n.id)),
    [deleteNodes, selectedNodes],
  );

  /**
   * Keyboard path for the canvas (React Flow makes nodes focusable, but its own
   * key handling only moves nodes that are *selected*, and by 5px).
   *
   * Runs in the capture phase on purpose: `stopPropagation` there keeps both the
   * node wrapper's handler and React Flow's document-level `deleteKeyCode`
   * listener from acting on the same press, so a key is handled exactly once.
   */
  const onNodeKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Never swallow keys meant for a text field (no node type has one today,
      // but a future editable label must keep its arrows and Backspace).
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      // Before the node lookup: focus may be on the canvas, the minimap or the
      // legend when the user gives up on an armed connection.
      if (e.key === "Escape") {
        setConnectFrom(null);
        return;
      }

      const id = target?.closest?.(".react-flow__node")?.getAttribute("data-id");
      if (!id) return;

      const dir = ARROW_DIRS[e.key];
      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? NUDGE * NUDGE_FACTOR : NUDGE;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === id
              ? {
                  ...n,
                  position: { x: n.position.x + dir[0] * step, y: n.position.y + dir[1] * step },
                }
              : n,
          ),
        );
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        // The focused node plus anything else selected — same set the inspector's
        // delete button acts on. The builder has no confirm on delete (a wrong one
        // is undone by leaving without saving), so don't invent one here.
        deleteNodes([id, ...selectedNodes.map((n) => n.id)]);
        return;
      }
      // `c` both arms and lands a connection, so Enter keeps its ordinary
      // meaning (select → inspector). Overloading Enter meant that once a
      // connection was armed — easy to do by accident — pressing Enter on any
      // node silently wired an edge instead of opening it.
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        e.stopPropagation();
        setConnectFrom((from) => {
          if (from === null) return id;
          // Same rule as the drag path's `isValidConnection`.
          if (from !== id) {
            onConnect({ source: from, target: id, sourceHandle: null, targetHandle: null });
          }
          return null;
        });
        return;
      }
    },
    [deleteNodes, onConnect, selectedNodes, setNodes],
  );

  /**
   * Names each node for assistive tech, and rings the one a connection is armed
   * from. ponytail: re-mapped every render — same cost profile as `snapshot`.
   */
  const flowNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        ariaLabel: `${n.data.kind} step ${n.data.label}${
          n.id === connectFrom ? ", connecting from here" : ""
        }`,
        className: `${NODE_A11Y_CLASSES}${
          n.id === connectFrom ? " ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
        }`,
      })),
    [nodes, connectFrom],
  );

  async function onSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the pipeline a name first.");
      return;
    }
    // Snapshot the document once, up front. Two awaits sit between here and the
    // baseline assignment (the save itself, and the confirm on a 409), so
    // reading `nodes`/`edges` again down there can baseline a *different* draft
    // than the one that was sent: `dirty` never goes false, the effect above
    // never navigates, and `leaving` stays latched until some later edit
    // incidentally matches the baseline — at which point it navigates away
    // mid-edit.
    const draft: Draft = { name: trimmed, description, output, nodes, edges };
    try {
      const definition: Record<string, unknown> = {
        ...originalDoc.current,
        ...graphToPipeline({
          ...draft,
          // Keep whatever the stored document declared; the spread above would
          // otherwise let a hardcoded 1.0.0 downgrade a 2.3.0 pipeline.
          version:
            typeof originalDoc.current.version === "string"
              ? originalDoc.current.version
              : undefined,
        }),
      };
      if (!draft.output.trim()) delete definition.output;
      if (!draft.description.trim()) delete definition.description;
      // Editing an existing pipeline is an overwrite by definition. Creating one
      // is not: the API answers a name collision with 409 rather than silently
      // replacing a production definition, so ask before insisting.
      try {
        await savePipeline.mutateAsync({
          name: trimmed,
          definition,
          overwrite: Boolean(editKey),
        });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
        const replace = await confirm({
          title: `Replace the pipeline "${trimmed}"?`,
          description:
            "A pipeline with that name already exists. Saving replaces its stored definition — there is no undo.",
          confirmLabel: "Replace",
          destructive: true,
        });
        if (!replace) return;
        await savePipeline.mutateAsync({ name: trimmed, definition, overwrite: true });
      }
      toast.success(editKey ? "Saved" : "Pipeline created");
      // Clear the dirty guard before leaving, then let the effect above navigate.
      setName(trimmed);
      setBaseline(snapshot(draft));
      setLeaving(true);
    } catch (err) {
      toastError(err);
    }
  }

  const saving = savePipeline.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Button asChild variant="ghost" size="icon" title="Back">
          <Link to={LIST_PATH}>
            <ArrowLeft />
          </Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Pipeline name"
          disabled={Boolean(editKey)}
          className="h-8 w-56 font-medium"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="h-8 w-72"
        />
        <Input
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          placeholder="Output var (optional)"
          title="Which step output_var is the pipeline's final result"
          className="h-8 w-44 font-mono text-xs"
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="tnum text-xs text-muted-foreground">
            {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge
            {edges.length === 1 ? "" : "s"}
            {dirty && " · unsaved"}
          </span>
          <Button size="sm" onClick={onSave} disabled={saving || loading}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <Palette groups={palette} onAdd={(item) => addNode(item)} />
        <div className="relative min-w-0 flex-1" onKeyDownCapture={onNodeKeyDown}>
          <ReactFlow
            nodes={flowNodes}
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
          <ShortcutLegend
            connecting={
              connectFrom
                ? (nodes.find((n) => n.id === connectFrom)?.data.label ?? connectFrom)
                : null
            }
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-lg border border-dashed border-border px-6 py-4 text-sm text-muted-foreground">
                Drag agents from the palette, then attach tools to a node.
              </p>
            </div>
          )}
        </div>
        {selected && (
          <Inspector
            node={selected}
            selectedCount={selectedNodes.length}
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

export function PipelineBuilderPage() {
  const params = useParams({ strict: false }) as { name?: string };
  // Key forces a fresh canvas when switching between /new and /$name/edit.
  return (
    <ReactFlowProvider key={params.name ?? "new"}>
      <BuilderCanvas editKey={params.name} />
    </ReactFlowProvider>
  );
}
