import { useMemo, useState } from "react";
import { AlertCircle, ChevronRight, ShieldX, Wrench } from "lucide-react";
import type { IterationTrace, TaskTrace, ToolCallTrace } from "@/api/models";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { humanizeKey, relativeTime, tokens, usd } from "@/lib/format";
import { copyText } from "@/lib/clipboard";
import { readablePayload } from "@/lib/tool-payload";
import { Markdown } from "@/components/markdown";
import { Stat, StatGrid } from "@/components/ui/stat";

/**
 * A single tool call can carry a whole log file or file read; the DOM does not
 * need all of it. The cap bounds the rendered text — but only the memo below
 * bounds the *work*: `JSON.stringify` runs over the full payload before the
 * slice, so a 50-call trace was re-stringifying 100 unbounded payloads on every
 * 5s poll, open or not (`<details>` hides its children with CSS; React keeps
 * rendering them).
 */
const MAX_PAYLOAD_CHARS = 100_000;

// eslint-disable-next-line react-refresh/only-export-components -- pure helper, shared with the detail page
export function truncateText(text: string, limit = MAX_PAYLOAD_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… truncated (${text.length.toLocaleString()} characters total)`;
}

/** Pretty-print a JSON value; pass strings through unchanged. Always capped. */
function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return truncateText(v);
  try {
    return truncateText(JSON.stringify(v, null, 2) ?? String(v));
  } catch {
    return truncateText(String(v));
  }
}

function durationLabel(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

/** Arrays longer than this render a "+N more" row; Raw still has everything. */
const MAX_LIST_ITEMS = 50;

/** Recursive key/value render of a parsed JSON value. */
function ValueView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "string") {
    const text = truncateText(value);
    return text.includes("\n") || text.length > 120 ? (
      <span className="block whitespace-pre-wrap break-words">{text}</span>
    ) : (
      <span className="break-words">{text}</span>
    );
  }
  if (typeof value !== "object") return <span className="font-mono">{String(value)}</span>;
  // ponytail: depth cap instead of virtualisation; deeper nodes fall back to JSON.
  if (depth >= 4) return <span className="block whitespace-pre-wrap font-mono">{asText(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">none</span>;
    return (
      <ol className="space-y-1.5">
        {value.slice(0, MAX_LIST_ITEMS).map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-5 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <ValueView value={item} depth={depth + 1} />
            </div>
          </li>
        ))}
        {value.length > MAX_LIST_ITEMS && (
          <li className="text-muted-foreground">+{value.length - MAX_LIST_ITEMS} more (see Raw)</li>
        )}
      </ol>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-muted-foreground">empty</span>;
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{humanizeKey(k)}</dt>
          <dd className="min-w-0">
            <ValueView value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Readable body of a payload: markdown for tool prose, key/value for objects. */
function ReadableView({ value }: { value: unknown }) {
  const parsed = useMemo(() => readablePayload(value), [value]);
  if (parsed.kind === "empty") return <span className="text-muted-foreground">empty</span>;
  if (parsed.kind === "text") {
    const text = truncateText(parsed.text);
    return parsed.markdown ? (
      <Markdown className="text-sm" math={false}>{text}</Markdown>
    ) : (
      <span className="block whitespace-pre-wrap break-words">{text}</span>
    );
  }
  return <ValueView value={parsed.value} />;
}

/** A collapsible labelled input/output block, readable by default with a Raw toggle. */
function Payload({
  label,
  value,
  tone = "default",
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  tone?: "default" | "danger";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [raw, setRaw] = useState(false);
  const empty = value == null || value === "";
  const rawText = useMemo(() => (open && raw ? asText(value) : ""), [open, raw, value]);
  if (empty) return null;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
      <summary className="flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {label}
        {open && (
          <span className="ml-auto flex gap-1">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 hover:bg-accent"
              onClick={(e) => {
                e.preventDefault();
                setRaw((r) => !r);
              }}
            >
              {raw ? "Readable" : "Raw"}
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 hover:bg-accent"
              onClick={(e) => {
                e.preventDefault();
                const p = readablePayload(value);
                void copyText(p.kind === "text" ? p.text : asText(value), label);
              }}
            >
              Copy
            </button>
          </span>
        )}
      </summary>
      {open && (
        <div
          className={cn(
            "mt-1.5 max-h-[32rem] overflow-auto break-words rounded-md border border-border bg-muted/50 p-3 text-xs",
            tone === "danger" && "border-destructive/40 bg-destructive/5 text-destructive",
          )}
        >
          {raw ? <pre className="whitespace-pre-wrap font-mono">{rawText}</pre> : <ReadableView value={value} />}
        </div>
      )}
    </details>
  );
}

/** One tool invocation: name, status, timing, and its input + output payloads. */
export function ToolCall({ call, collapsed = false }: { call: ToolCallTrace; collapsed?: boolean }) {
  const denied = !call.permission_check.granted;
  const failed = Boolean(call.error);
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-sm font-medium">{call.tool_name}</span>
        {denied && (
          <Badge variant="muted" className="gap-1 bg-destructive/15 text-destructive">
            <ShieldX className="size-3" /> denied
          </Badge>
        )}
        {failed && !denied && (
          <Badge variant="muted" className="gap-1 bg-destructive/15 text-destructive">
            <AlertCircle className="size-3" /> error
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{durationLabel(call.duration_ms)}</span>
        {call.injection_score != null && (
          <Badge variant="muted" title="Prompt-injection score">
            inj {call.injection_score.toFixed(2)}
          </Badge>
        )}
      </div>

      {denied && call.permission_check.deny_reason && (
        <p className="mt-2 text-xs text-destructive">{call.permission_check.deny_reason}</p>
      )}

      <div className="mt-2 space-y-1.5">
        <Payload label="Input" value={call.input_json} />
        {failed ? (
          <Payload label="Error" value={call.error} tone="danger" defaultOpen />
        ) : (
          <Payload label="Output" value={call.output_json} defaultOpen={!collapsed} />
        )}
      </div>
    </div>
  );
}

/** One LLM iteration: model + token/stop metadata, then its tool calls. */
function Iteration({ it }: { it: IterationTrace }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm">Iteration {it.iteration}</CardTitle>
          <Badge variant="outline" className="font-mono">
            {it.model}
          </Badge>
          <Badge variant="muted">{it.stop_reason}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {relativeTime(it.started_at)}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{tokens(it.input_tokens)} in</span>
          <span>{tokens(it.output_tokens)} out</span>
          <span>
            {it.tool_calls.length} tool call{it.tool_calls.length === 1 ? "" : "s"}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {it.tool_calls.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tool calls in this iteration.</p>
        ) : (
          <div className="space-y-2">
            {it.tool_calls.map((c, i) => (
              <ToolCall key={i} call={c} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Structured render of a task's execution trace: iterations + tool calls. */
export function TaskTraceView({ trace }: { trace: TaskTrace }) {
  const toolCalls = trace.iterations.reduce((n, it) => n + it.tool_calls.length, 0);
  return (
    <div className="space-y-4">
      <StatGrid min={130}>
        <Stat size="sm" label="Iterations" value={trace.iterations.length} />
        <Stat size="sm" label="Tool calls" value={toolCalls} />
        <Stat size="sm" label="Input tokens" value={tokens(trace.total_input_tokens)} />
        <Stat size="sm" label="Output tokens" value={tokens(trace.total_output_tokens)} />
        <Stat size="sm" label="Cost" value={usd(trace.total_cost_usd)} />
        <Stat
          size="sm"
          label="Finished"
          value={trace.finished_at ? relativeTime(trace.finished_at) : "—"}
        />
      </StatGrid>

      {trace.iterations.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No iterations recorded yet for this task.
        </p>
      ) : (
        trace.iterations.map((it) => <Iteration key={it.iteration} it={it} />)
      )}
    </div>
  );
}
