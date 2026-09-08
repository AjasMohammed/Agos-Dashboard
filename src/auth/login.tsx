import { useState, type FormEvent } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { login } from "./actions";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Post-login destination, validated. `?redirect=` is attacker-controllable, so
 * only a local path is accepted: "//evil.com" and "/\evil.com" are
 * protocol-relative URLs, and an absolute URL would send the operator off-site.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, unit-tested alongside the page it guards
export function safeRedirect(to: string | undefined): string {
  if (!to || !to.startsWith("/")) return "/";
  // Browsers strip control characters before parsing, so "/\t/evil.com" is read
  // as "//evil.com" and slips past the checks below. `pushState` then throws
  // SecurityError rather than navigating off-origin, but that throw lands in the
  // submit catch and tells someone who just signed in that login failed.
  for (const ch of to) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return "/";
  }
  if (to.startsWith("//") || to.startsWith("/\\")) return "/";
  return to;
}

export function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { redirect?: string };
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(credential.trim());
      navigate({ to: safeRedirect(search.redirect) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setError("Login is disabled on this server: no operator token is configured.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError(
          "That access key wasn't accepted. Check [api] operator_token in ~/.agentos/config.toml.",
        );
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Login failed. Is the API reachable?");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground">
            A
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight">AgentOS Control Panel</p>
            <p className="text-xs text-muted-foreground">Operate agents, tasks and integrations.</p>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use the operator access key configured on your kernel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <Field
                label="Access key"
                hint="The [api] operator_token value from the kernel config."
              >
                <Input
                  id="credential"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  spellCheck={false}
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  className="h-9 font-mono"
                  placeholder="••••••••••••"
                />
              </Field>
              {error && (
                <Callout tone="danger" role="alert">
                  {error}
                </Callout>
              )}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={submitting || !credential.trim()}
              >
                {submitting && <Loader2 className="animate-spin" />}
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          The key is exchanged for a scoped session that lives only in this browser.
        </p>
      </div>
    </div>
  );
}
