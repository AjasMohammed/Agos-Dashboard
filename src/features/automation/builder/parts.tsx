import { memo, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot, Flag, Play, Search, Wrench, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DND_TYPE, type BuilderNode, type StepData, type StepKind } from "./graph";

export interface PaletteItem {
  label: string;
  sub?: string;
  data: StepData;
}

const KIND_META: Record<StepKind, { icon: LucideIcon; className: string }> = {
  start: { icon: Play, className: "bg-success/15 text-success" },
  end: { icon: Flag, className: "bg-warning/15 text-warning" },
  agent: { icon: Bot, className: "bg-primary/15 text-primary" },
  tool: { icon: Wrench, className: "bg-secondary text-secondary-foreground" },
};

/** The single custom React Flow node used by both builders. */
export const StepNode = memo(function StepNode({ data, selected }: NodeProps<BuilderNode>) {
  const meta = KIND_META[data.kind];
  const Icon = meta.icon;
  const sub =
    data.kind === "agent"
      ? data.agent || "pick an agent"
      : data.kind === "tool"
        ? data.tool || "pick a tool"
        : data.kind;
  return (
    <div
      className={cn(
        "min-w-44 max-w-56 rounded-lg border bg-card shadow-card transition-shadow",
        selected ? "border-primary shadow-glow" : "border-border",
        data.disabled && "opacity-50",
      )}
    >
      {data.kind !== "start" && (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-2.5 !border-2 !border-background !bg-muted-foreground"
        />
      )}
      <div className="flex items-center gap-2.5 p-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            meta.className,
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{data.label}</span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground">{sub}</span>
        </span>
      </div>
      {data.kind !== "end" && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-2.5 !border-2 !border-background !bg-primary"
        />
      )}
    </div>
  );
});

/** Searchable, draggable node palette (click also adds at a free spot). */
export function Palette({
  groups,
  onAdd,
}: {
  groups: { label: string; items: PaletteItem[] }[];
  onAdd: (item: PaletteItem) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) =>
          `${i.label} ${i.sub ?? ""}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

  function onDragStart(e: DragEvent, item: PaletteItem) {
    e.dataTransfer.setData(DND_TYPE, JSON.stringify(item.data));
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="relative p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search nodes…"
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-2 pb-3">
        {filtered.map((g) => (
          <div key={g.label}>
            <p className="px-1 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              {g.label}
            </p>
            <ul className="space-y-1">
              {g.items.map((item) => {
                const meta = KIND_META[item.data.kind];
                const Icon = meta.icon;
                return (
                  <li key={`${item.data.kind}:${item.label}`}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => onDragStart(e, item)}
                      onClick={() => onAdd(item)}
                      title="Drag onto the canvas (or click to add)"
                      className="flex w-full cursor-grab items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-accent/50 active:cursor-grabbing"
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded",
                          meta.className,
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.label}</span>
                        {item.sub && (
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {item.sub}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">No nodes match.</p>
        )}
      </div>
    </aside>
  );
}

/** Labeled field row used by the inspector panels. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
