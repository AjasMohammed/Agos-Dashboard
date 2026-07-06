import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

/**
 * Route-level error boundary for the authenticated app. Without this a render
 * throw (e.g. backend payload drift reaching a component) white-screens the
 * whole shell; here it degrades to a recoverable full-page message + reload.
 */
export function AppErrorBoundary({ error }: ErrorComponentProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="size-8 text-destructive" />
      <div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
