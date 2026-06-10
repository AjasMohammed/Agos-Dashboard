import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { eventDetails, parseEventDetails, relativeTime, absoluteTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type EventLogEntry = {
  event_type: string;
  details: string;
  timestamp: string;
  agent_id?: string | null;
};

/** Friendly rendering of a parsed `details` payload (no raw JSON). */
function EventDetailsBody({ details }: { details: string }) {
  const parsed = parseEventDetails(details);

  if (parsed.kind === "empty") {
    return <p className="text-xs text-muted-foreground">No additional details.</p>;
  }
  if (parsed.kind === "text") {
    return <p className="whitespace-pre-wrap break-words text-xs text-foreground/80">{parsed.text}</p>;
  }
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
      {parsed.fields.map((f) => (
        <div key={f.key} className="grid gap-1 sm:contents">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {f.label}
          </dt>
          <dd className="min-w-0 text-xs text-foreground/90">
            {f.nested ? (
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                {f.nested}
              </pre>
            ) : (
              <span className="break-words font-mono">{f.value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A single expandable activity/audit row: click to reveal friendly details. */
export function EventLogItem({ entry, className }: { entry: EventLogEntry; className?: string }) {
  const [open, setOpen] = useState(false);
  const summary = eventDetails(entry.details);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm transition-colors hover:text-foreground"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="font-mono text-xs font-medium text-primary">{entry.event_type}</span>
          {!open && <span className="truncate text-muted-foreground">{summary}</span>}
        </span>
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={absoluteTime(entry.timestamp)}
        >
          {relativeTime(entry.timestamp)}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mb-2 rounded-md border border-border bg-background/50 px-3 py-3 pl-7">
              <EventDetailsBody details={entry.details} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
