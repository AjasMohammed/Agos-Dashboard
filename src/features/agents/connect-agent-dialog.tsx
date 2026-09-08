import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useConnectAgent, useProviders } from "@/api/queries/agents";
import { useSecrets, useSetSecret } from "@/api/queries/system";
import { keyOptions } from "@/lib/provider-keys";
import type { Provider } from "@/api/models";
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

// Shown only until `GET /api/v1/providers` answers (or if it fails). The live
// catalog is the source of truth — this list is a fallback, not a whitelist.
const FALLBACK_PROVIDERS: Provider[] = [
  {
    name: "anthropic",
    display_name: "Anthropic",
    source: "built-in",
    api_key_env: "ANTHROPIC_API_KEY",
    api_key_set: false,
    models: [],
  },
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
  // Key material lives outside `form` so `setForm(BLANK)` can never carry it
  // into a second agent, and so it is cleared on its own after the vault write.
  const [apiKey, setApiKey] = useState("");
  const [keyChoice, setKeyChoice] = useState("");
  const [shareKey, setShareKey] = useState(true);
  const connect = useConnectAgent();
  const setSecret = useSetSecret();
  const providers = useProviders(open);
  const secrets = useSecrets(open);
  const options = providers.data?.length ? providers.data : FALLBACK_PROVIDERS;
  const entry = options.find((p) => p.name === form.provider);
  const models = entry?.models ?? [];
  const { needsKey, sharedKeyName, hasSaved, envKey } = keyOptions(
    entry,
    form.provider,
    (secrets.data ?? []).flatMap((s) => (s.name ? [s.name] : [])),
  );
  const keyMode = keyChoice || (hasSaved ? "saved" : envKey ? "env" : "new");
  const set = (key: keyof typeof BLANK, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  // Switching provider carries the old provider's model over, which is never
  // valid on the new one — reset it to that provider's catalog default.
  const setProvider = (name: string) => {
    const next = options.find((p) => p.name === name);
    const dflt = (next && "default_model" in next ? next.default_model : "") || "";
    setForm((f) => ({ ...f, provider: name, model: dflt }));
    // A key typed for the old provider must never be stored under the new
    // provider's secret name, and "saved"/"env" may not exist on the new one.
    setApiKey("");
    setKeyChoice("");
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      if (needsKey && keyMode === "new" && apiKey.trim()) {
        await setSecret.mutateAsync({
          name: shareKey ? sharedKeyName : `${form.name.trim()}_${sharedKeyName}`,
          value: apiKey.trim(),
          // Not `agent:<name>`: that scope resolves against the agent registry,
          // and the agent cannot exist yet — connect needs the key to build its
          // adapter. The name prefix is what scopes a per-agent key anyway.
          scope: "global",
        });
        // Drop both plaintext copies now it is in the vault: this dialog stays
        // mounted if `connect` below rejects, and react-query holds the
        // mutation's `variables` (the key) for the observer's lifetime.
        setApiKey("");
        setSecret.reset();
        // Back to the derived default: once the refetched secrets list shows a
        // shared key this becomes "saved". Pinning "saved" here would select an
        // option that does not exist when the key was stored per-agent.
        setKeyChoice("");
      }
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
      toast.success(`Assistant "${form.name}" is ready`);
      setForm(BLANK);
      setApiKey("");
      setKeyChoice("");
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
          setForm(BLANK);
          setApiKey("");
          setKeyChoice("");
        }
      }}
    >
      <DialogTrigger asChild>{trigger ?? <Button>Add assistant</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add assistant</DialogTitle>
          <DialogDescription>Point AgentOS at a model and give it a name.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <Select value={form.provider} onChange={(e) => setProvider(e.target.value)}>
                {options.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.display_name || p.name}
                  </option>
                ))}
                <option value="custom">custom</option>
              </Select>
            </Field>
            <Field label="Model">
              <>
                <Input
                  value={form.model}
                  onChange={(e) => set("model", e.target.value)}
                  required
                  list="provider-models"
                  placeholder="claude-opus-4-8"
                />
                {/* Suggestions, not a whitelist — catalogs lag new model ids. */}
                <datalist id="provider-models">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            </Field>
          </div>
          <Field label="Base URL (optional)">
            <Input
              value={form.base_url}
              onChange={(e) => set("base_url", e.target.value)}
              placeholder="https://…"
            />
          </Field>
          {needsKey && (
            <Field label="API key">
              <>
                <Select value={keyMode} onChange={(e) => setKeyChoice(e.target.value)}>
                  {hasSaved && <option value="saved">Use saved key ({sharedKeyName})</option>}
                  {envKey && <option value="env">Use {envKey} from the environment</option>}
                  <option value="new">Enter a new key…</option>
                </Select>
                {keyMode === "new" && (
                  <>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      placeholder="sk-…"
                    />
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={shareKey}
                        onChange={(e) => setShareKey(e.target.checked)}
                      />
                      Share with every {form.provider} assistant
                    </label>
                  </>
                )}
              </>
            </Field>
          )}
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
              disabled={
                connect.isPending ||
                setSecret.isPending ||
                !form.name.trim() ||
                !form.model.trim()
              }
            >
              {connect.isPending || setSecret.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
