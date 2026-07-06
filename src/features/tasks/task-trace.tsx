import { AlertCircle, ChevronRight, ShieldX, Wrench } from "lucide-react";
import type { IterationTrace, TaskTrace, ToolCallTrace } from "@/api/models";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { relativeTime, tokens, usd } from "@/lib/format";

/** Pretty-print a JSON value; pass strings through unchanged. */
function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
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
  const text = asText(value);
  if (!text) return null;
  return (
    <details open={defaultOpen} className="group">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

/** Structured render of a task's execution trace: iterations + tool calls. */
export function TaskTraceView({ trace }: { trace: TaskTrace }) {
  const toolCalls = trace.iterations.reduce((n, it) => n + it.tool_calls.length, 0);
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Iterations" value={String(trace.iterations.length)} />
          <Stat label="Tool calls" value={String(toolCalls)} />
          <Stat label="Input tokens" value={tokens(trace.total_input_tokens)} />
          <Stat label="Output tokens" value={tokens(trace.total_output_tokens)} />
          <Stat label="Cost" value={usd(trace.total_cost_usd)} />
          <Stat
            label="Finished"
            value={trace.finished_at ? relativeTime(trace.finished_at) : "—"}
          />
        </CardContent>
      </Card>

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
