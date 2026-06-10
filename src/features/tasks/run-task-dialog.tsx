import { useState, type FormEvent } from "react";
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
import { Textarea } from "@/components/ui/textarea";

export function RunTaskDialog() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [agentName, setAgentName] = useState("");
  const [autonomous, setAutonomous] = useState(false);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run a task</DialogTitle>
          <DialogDescription>Dispatch a prompt to an agent.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              autoFocus
              className="min-h-[120px]"
              placeholder="Summarize the latest audit events…"
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
