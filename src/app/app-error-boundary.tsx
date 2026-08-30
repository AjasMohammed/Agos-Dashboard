import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

/**
 * Recovery UI for a render throw (e.g. backend payload drift reaching a
 * component). Rendered inside the shell's CatchBoundary for app pages, and as
 * the router's `defaultErrorComponent` for root/login/welcome.
 *
 * Deliberately NOT `window.location.reload()`: the API key lives in memory
 * (VITE_REFRESH_ENABLED=false by default), so a reload logs the operator out.
 * `reset()` re-renders the boundary's children in place instead.
 */
export function AppErrorBoundary({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="size-8 text-destructive" />
      <div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
