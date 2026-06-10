import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useConnectAgent } from "@/api/queries/agents";
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

const PROVIDERS = [
  "anthropic",
  "openai",
  "gemini",
  "ollama",
  "mistral",
  "xai",
  "cohere",
  "azure",
  "custom",
];
const THINKING = ["off", "low", "medium", "high", "max"];

const BLANK = {
  name: "",
  provider: "anthropic",
  model: "",
  base_url: "",
  roles: "",
  description: "",
  thinking_level: "off",
  system_prompt: "",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function ConnectAgentDialog({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const connect = useConnectAgent();
  const set = (key: keyof typeof BLANK, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await connect.mutateAsync({
        name: form.name.trim(),
        provider: form.provider,
        model: form.model.trim(),
        base_url: form.base_url.trim() || undefined,
        roles: form.roles
          ? form.roles
              .split(",")
              .map((r) => r.trim())
              .filter(Boolean)
          : undefined,
        description: form.description.trim() || undefined,
        thinking_level: form.thinking_level,
        system_prompt: form.system_prompt.trim() || undefined,
      });
      toast.success(`Agent "${form.name}" connected`);
      setForm(BLANK);
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
        if (!o) setForm(BLANK);
      }}
    >
      <DialogTrigger asChild>{trigger ?? <Button>Connect agent</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect agent</DialogTitle>
          <DialogDescription>Register an LLM agent with the kernel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <Select value={form.provider} onChange={(e) => set("provider", e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Model">
              <Input
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                required
                placeholder="claude-opus-4-8"
              />
            </Field>
          </div>
          <Field label="Base URL (optional)">
            <Input
              value={form.base_url}
              onChange={(e) => set("base_url", e.target.value)}
              placeholder="https://…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Roles (comma-separated)">
              <Input
                value={form.roles}
                onChange={(e) => set("roles", e.target.value)}
                placeholder="researcher, coder"
              />
            </Field>
            <Field label="Thinking level">
              <Select
                value={form.thinking_level}
                onChange={(e) => set("thinking_level", e.target.value)}
              >
                {THINKING.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description (optional)">
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="System prompt (optional)">
            <Textarea
              value={form.system_prompt}
              onChange={(e) => set("system_prompt", e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={connect.isPending || !form.name.trim() || !form.model.trim()}
            >
              {connect.isPending ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
