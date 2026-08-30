import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useConnectAgent } from "@/api/queries/agents";
import { useSetSecret } from "@/api/queries/system";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EASE_OUT } from "@/components/motion";
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
    secret: "anthropic_api_key",
    keyHint: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: ["claude-opus-4-8", "claude-sonnet-4-5", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    label: "OpenAI",
    secret: "openai_api_key",
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    secret: "gemini_api_key",
    keyHint: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "ollama",
    label: "Ollama (on this machine)",
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
    <ol className="mb-6 flex items-center gap-2 text-xs">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border text-[10px]",
              i < step
                ? "border-primary bg-primary text-primary-foreground"
                : i === step
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground",
            )}
          >
            {i < step ? <Check className="size-3" /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-medium" : "text-muted-foreground")}>{l}</span>
          {i < labels.length - 1 && <span className="w-4 border-t border-border" />}
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
        await setSecret.mutateAsync({ name: provider.secret, value: apiKey.trim() });
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
    <div className="bg-grid relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[120px]"
      />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
        className="relative w-full max-w-md"
      >
        <Card className="border-border/80 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg tracking-tight">Set up your first assistant</CardTitle>
            <CardDescription>
              Pick a model provider, add its key, and you can start chatting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Steps step={step} />

            {step === 0 && (
              <div className="grid gap-2">
                {PROVIDERS.map((p) => (
                  <Button
                    key={p.id}
                    variant="outline"
                    className="justify-start"
                    onClick={() => chooseProvider(p)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            )}

            {step === 1 && (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setStep(2);
                }}
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="api-key">{provider.label} API key</Label>
                  <Input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    autoFocus
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={keySaved ? "Saved — leave blank to keep it" : provider.keyHint}
                  />
                  <p className="text-xs text-muted-foreground">
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
                  </p>
                </div>
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
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void finish();
                }}
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    list="welcome-models"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    autoFocus
                  />
                  {/* Free text with suggestions — model ids move faster than this list. */}
                  <datalist id="welcome-models">
                    {provider.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="assistant-name">Call it</Label>
                  <Input
                    id="assistant-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
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
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Want more options?{" "}
          <button className="underline" onClick={() => navigate({ to: "/agents" as string })}>
            Add an assistant the long way
          </button>
          {" · "}
          <button className="underline" disabled={busy} onClick={() => navigate({ to: "/" })}>
            Skip for now
          </button>
        </p>
      </motion.div>
    </div>
  );
}
