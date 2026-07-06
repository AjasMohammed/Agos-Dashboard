import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useRunTask } from "@/api/queries/tasks";
import { useAgents } from "@/api/queries/agents";
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
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MentionTextarea } from "@/components/mention-textarea";

export function RunTaskDialog() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [agentName, setAgentName] = useState("");
  const [autonomous, setAutonomous] = useState(false);
  // While the @file menu is open, Escape must close it — not the dialog
  // (Radix's capture-phase Escape listener would otherwise win and wipe the form).
  const mentionMenuOpen = useRef(false);
  const run = useRunTask();
  const agents = useAgents();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await run.mutateAsync({
        prompt: prompt.trim(),
        agent_name: agentName || undefined,
        autonomous,
      });
      toast.success("Task started");
      setPrompt("");
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPrompt("");
          setAgentName("");
          setAutonomous(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>New task</Button>
      </DialogTrigger>
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (mentionMenuOpen.current) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Run a task</DialogTitle>
          <DialogDescription>Dispatch a prompt to an agent.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Prompt</Label>
            <MentionTextarea
              value={prompt}
              onValueChange={setPrompt}
              onMenuOpenChange={(open) => (mentionMenuOpen.current = open)}
              required
              autoFocus
              className="min-h-[120px]"
              menuPlacement="bottom"
              placeholder="Summarize the latest audit events… (@ mentions an uploaded file)"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Agent (optional — kernel routes if unset)</Label>
            <Select value={agentName} onChange={(e) => setAgentName(e.target.value)}>
              <option value="">Auto-route</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name} ({a.model})
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autonomous}
              onChange={(e) => setAutonomous(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Autonomous (multi-step, no per-step approval)
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={run.isPending || !prompt.trim()}>
              {run.isPending ? "Starting…" : "Run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
