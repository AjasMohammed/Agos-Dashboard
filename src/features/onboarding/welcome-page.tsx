import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { useConnectAgent } from "@/api/queries/agents";
import { useSetSecret } from "@/api/queries/system";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * Providers offered on first run. `secret` is the vault key the kernel reads
 * when building the adapter (`commands/agent.rs` → `<provider>_api_key`, with a
 * per-agent `<agent>_<provider>_api_key` taking precedence); an empty string
 * means the provider needs no key.
 *
 * ponytail: a curated shortlist, not the 20-provider catalog — the wizard is
 * for people who don't know what to pick. Everything else stays one click away
 * in Agents → Add assistant. Add `GET /api/v1/providers` only if this list
 * starts going stale in practice.
 */
const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic",
    blurb: "Claude models",
    secret: "anthropic_api_key",
    keyHint: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: ["claude-opus-4-8", "claude-sonnet-4-5", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT models",
    secret: "openai_api_key",
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    blurb: "Gemini models",
    secret: "gemini_api_key",
    keyHint: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "ollama",
    label: "Ollama",
    blurb: "Local models on this machine, no key needed",
    secret: "",
    keyHint: "",
    keyUrl: "",
    models: ["llama3.1", "qwen2.5", "mistral"],
  },
] as const;

type Provider = (typeof PROVIDERS)[number];

function Steps({ step }: { step: number }) {
  const labels = ["Provider", "API key", "Model"];
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs" aria-label="Setup progress">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border text-[10px] font-medium",
              i < step
                ? "border-primary bg-primary text-primary-foreground"
                : i === step
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground",
            )}
          >
            {i < step ? <Check aria-hidden className="size-3" /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-medium" : "text-muted-foreground")}>{l}</span>
          {i < labels.length - 1 && <span aria-hidden className="w-5 border-t border-border" />}
        </li>
      ))}
    </ol>
  );
}

export function WelcomePage() {
  const navigate = useNavigate();
  const setSecret = useSetSecret();
  const connect = useConnectAgent();
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<string>(PROVIDERS[0].models[0]);
  const [name, setName] = useState("assistant");
  // The key field is cleared as soon as the vault accepts it, so this is what
  // tells step 1 the blank field is fine (Back after a failed `connect`).
  const [keySaved, setKeySaved] = useState(false);

  const needsKey = provider.secret !== "";
  const busy = setSecret.isPending || connect.isPending;

  function chooseProvider(p: Provider) {
    // Back → re-pick the same provider keeps the typed key and model.
    if (p.id !== provider.id) {
      setProvider(p);
      setModel(p.models[0]);
      // A key typed for the previous provider must never be written under this
      // provider's secret name (Back → pick another → Finish would store e.g.
      // sk-ant-… as `openai_api_key`, failing later with an opaque 401).
      setApiKey("");
      setKeySaved(false);
    }
    // Ollama runs locally and needs no key — skip straight to the model step.
    setStep(p.secret === "" ? 2 : 1);
  }

  async function finish() {
    try {
      // `apiKey` is empty after a successful store below, so a retry (connect
      // failed, user hits "Start chatting" again) skips the write instead of
      // overwriting the saved key with "".
      if (needsKey && apiKey.trim()) {
        await setSecret.mutateAsync({
          name: provider.secret,
          value: apiKey.trim(),
          // A provider key has to be readable by the kernel and by every agent
          // that talks to that provider, so first-run onboarding writes global.
          scope: "global",
        });
        // It's in the vault now — drop both remaining copies: this form stays
        // mounted if `connect` below rejects, and react-query retains the
        // mutation's `variables` (the plaintext key) for the observer's
        // lifetime plus gcTime, readable from DevTools or a heap snapshot.
        setApiKey("");
        setSecret.reset();
        setKeySaved(true);
      }
      await connect.mutateAsync({
        name: name.trim(),
        provider: provider.id,
        model: model.trim(),
        thinking_level: "medium",
      });
      navigate({ to: "/" });
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground">
            A
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight">AgentOS Control Panel</p>
            <p className="text-xs text-muted-foreground">First-run setup</p>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Set up your first assistant</CardTitle>
            <CardDescription>
              Pick a model provider, add its key, and you can start chatting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Steps step={step} />

            {step === 0 && (
              <div className="grid gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => chooseProvider(p)}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">{p.blurb}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            {step === 1 && (
              <form
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setStep(2);
                }}
              >
                <Field
                  label={`${provider.label} API key`}
                  hint={
                    <>
                      Stored encrypted in the vault as{" "}
                      <code className="font-mono">{provider.secret}</code>. It is never shown again.{" "}
                      {provider.keyUrl && (
                        <a
                          href={provider.keyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:text-foreground"
                        >
                          Get a key
                        </a>
                      )}
                    </>
                  }
                >
                  <Input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={keySaved ? "Saved — leave blank to keep it" : provider.keyHint}
                    className="font-mono"
                  />
                </Field>
                <div className="flex justify-between">
                  <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                    Back
                  </Button>
                  {/* Blank is allowed once the key is in the vault — otherwise
                      Back from step 3 would be a dead end after the field is
                      scrubbed. */}
                  <Button type="submit" disabled={!apiKey.trim() && !keySaved}>
                    Continue
                  </Button>
                </div>
              </form>
            )}

            {step === 2 && (
              <form
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void finish();
                }}
              >
                <Field label="Model" hint="Free text with suggestions — model ids move faster than any list.">
                  <Input
                    id="model"
                    list="welcome-models"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    autoFocus
                    spellCheck={false}
                    className="font-mono"
                  />
                </Field>
                <datalist id="welcome-models">
                  {provider.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <Field label="Name" hint="How this assistant appears in chat and in the agent list.">
                  <Input
                    id="assistant-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    spellCheck={false}
                  />
                </Field>
                <div className="flex justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep(needsKey ? 1 : 0)}
                    disabled={busy}
                  >
                    Back
                  </Button>
                  <Button type="submit" disabled={busy || !model.trim() || !name.trim()}>
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    {busy ? "Setting up…" : "Start chatting"}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Want more options?{" "}
          <button
            type="button"
            className="cursor-pointer underline hover:text-foreground"
            onClick={() => navigate({ to: "/agents" as string })}
          >
            Add an assistant the long way
          </button>
          {" · "}
          <button
            type="button"
            className="cursor-pointer underline hover:text-foreground"
            disabled={busy}
            onClick={() => navigate({ to: "/" })}
          >
            Skip for now
          </button>
        </p>
      </div>
    </div>
  );
}
