import { useMemo, useState } from "react";
import { AlertCircle, ChevronRight, ShieldX, Wrench } from "lucide-react";
import type { IterationTrace, TaskTrace, ToolCallTrace } from "@/api/models";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { relativeTime, tokens, usd } from "@/lib/format";
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

/** A collapsible labelled JSON/text block (input or output). */
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
  // Cheap enough to decide "is there anything here" without stringifying:
  // `asText` returns "" for exactly these two.
  const empty = value == null || value === "";
  const text = useMemo(() => (open ? asText(value) : ""), [open, value]);
  if (empty) return null;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
      <summary className="flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <pre
        className={cn(
          "mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/50 p-3 text-xs",
          tone === "danger" && "border-destructive/40 bg-destructive/5 text-destructive",
        )}
      >
        {text}
      </pre>
    </details>
  );
}

/** One tool invocation: name, status, timing, and its input + output payloads. */
function ToolCall({ call }: { call: ToolCallTrace }) {
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
          <Payload label="Output" value={call.output_json} defaultOpen />
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
