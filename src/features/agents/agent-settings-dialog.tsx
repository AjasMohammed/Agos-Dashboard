import { useState, type FormEvent } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { useUpdateAgentSettings } from "@/api/queries/agents";
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

const THINKING = ["off", "low", "medium", "high", "max"];

export function AgentSettingsDialog({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [thinking, setThinking] = useState("medium");
  const update = useUpdateAgentSettings(name);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        agent_name: name,
        description: description.trim(),
        thinking_level: thinking,
        system_prompt: systemPrompt.trim() || undefined,
      });
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
        setOpen(o);
        if (!o) {
          setDescription("");
          setSystemPrompt("");
          setThinking("medium");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings /> Settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agent settings</DialogTitle>
          <DialogDescription>
            Update {name}. (The API does not return current values, so fields start blank.)
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label>Thinking level</Label>
            <Select value={thinking} onChange={(e) => setThinking(e.target.value)}>
              {THINKING.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>System prompt (optional)</Label>
            <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending || !description.trim()}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
