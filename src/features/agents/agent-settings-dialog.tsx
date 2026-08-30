import { useRef, useState, type FormEvent } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { useAgent, useUpdateAgentSettings } from "@/api/queries/agents";
import { toastError } from "@/lib/errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AgentDetail, UpdateAgentSettingsRequest } from "@/api/models";

const THINKING = ["off", "low", "medium", "high", "max"];

/** The three editable settings, flattened out of the agent detail payload. */
export interface AgentSettingsValues {
  description: string;
  thinking_level: string;
  system_prompt: string;
}

function settingsOf(detail: AgentDetail): AgentSettingsValues {
  return {
    description: detail.description ?? "",
    thinking_level: detail.thinking_level ?? "medium",
    system_prompt: detail.system_prompt ?? "",
  };
}

/**
 * Build the update payload from what the operator actually changed.
 *
 * Every field is optional server-side and an absent field means "leave
 * unchanged", so sending an untouched field is a write. This dialog used to
 * open blank and send all three unconditionally, which deleted a set system
 * prompt (and reset the thinking level) whenever someone fixed a description
 * typo. `system_prompt: ""` is a real value — it clears a prompt that was set —
 * so it is only sent when the box was non-empty on load.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, unit-tested
export function changedSettings(
  name: string,
  loaded: AgentSettingsValues,
  next: AgentSettingsValues,
): UpdateAgentSettingsRequest {
  const body: UpdateAgentSettingsRequest = { agent_name: name };
  const description = next.description.trim();
  if (description !== loaded.description) body.description = description;
  if (next.thinking_level !== loaded.thinking_level) body.thinking_level = next.thinking_level;
  if (next.system_prompt !== loaded.system_prompt) body.system_prompt = next.system_prompt;
  return body;
}

/** True when `changedSettings` produced nothing but the required agent name. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, unit-tested
export function isNoOp(body: UpdateAgentSettingsRequest): boolean {
  return Object.keys(body).length === 1;
}

export function AgentSettingsDialog({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  // Same query key as the detail page, so this is a cache read, not a second GET.
  const detail = useAgent(name);
  const update = useUpdateAgentSettings(name);
  const [values, setValues] = useState<AgentSettingsValues>({
    description: "",
    thinking_level: "medium",
    system_prompt: "",
  });
  // What the fields held when the dialog opened. Diffing against a live
  // `detail.data` would be wrong: a background refetch mid-edit would make an
  // untouched field look changed.
  const loaded = useRef<AgentSettingsValues>(values);

  const body = changedSettings(name, loaded.current, values);
  const set = (patch: Partial<AgentSettingsValues>) => setValues((v) => ({ ...v, ...patch }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (update.isPending) return;
    if (isNoOp(body)) {
      setOpen(false);
      return;
    }
    try {
      await update.mutateAsync(body);
      toast.success("Settings updated");
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        const data = detail.data;
        // Never open on unresolved data: the fields would prefill blanks and
        // saving would then write those blanks over the stored values.
        if (o && !data) return;
        if (o && data) {
          const v = settingsOf(data);
          loaded.current = v;
          setValues(v);
        }
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={!detail.data}
          title={detail.data ? undefined : "Loading current settings…"}
        >
          <Settings /> Settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agent settings</DialogTitle>
          <DialogDescription>
            Update {name}. Only the fields you change are sent.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input
              value={values.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Thinking level</Label>
            <Select
              value={values.thinking_level}
              onChange={(e) => set({ thinking_level: e.target.value })}
            >
              {THINKING.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>System prompt</Label>
            <Textarea
              value={values.system_prompt}
              onChange={(e) => set({ system_prompt: e.target.value })}
              className="min-h-[120px] font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Emptying this clears the agent&rsquo;s custom prompt.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending || isNoOp(body)}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
