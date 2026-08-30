import { useState, type FormEvent } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { login } from "./actions";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EASE_OUT } from "@/components/motion";

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
        setError("Login is disabled on this server (no operator token configured).");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("That operator token wasn't accepted. Check [api] operator_token in ~/.agentos/config.toml.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts — wait a minute.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Login failed — is the API reachable?");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-grid relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Soft brand glow behind the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[120px]"
      />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
        className="relative w-full max-w-sm"
      >
        <Card className="border-border/80 shadow-lg">
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-glow">
              <span className="font-mono font-bold">A</span>
            </div>
            <CardTitle className="text-lg tracking-tight">AgentOS Control Panel</CardTitle>
            <CardDescription>Sign in with your access key.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="credential" className="text-sm font-medium">
                  Access key
                </label>
                <input
                  id="credential"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="••••••••"
                />
              </div>
              <AnimatePresence initial={false}>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-sm text-destructive"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
              <Button type="submit" className="w-full" disabled={submitting || !credential.trim()}>
                {submitting && <Loader2 className="animate-spin" />}
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
