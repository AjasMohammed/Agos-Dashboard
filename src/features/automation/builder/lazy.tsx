import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

// The visual builder pulls in React Flow (~360 kB), so it's code-split out of
// the main bundle and loaded only when a builder route is opened.
const LazyPipelineBuilder = lazy(() =>
  import("./builder-page").then((m) => ({ default: m.PipelineBuilderPage })),
);

function BuilderFallback() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function PipelineBuilderPage() {
  return (
    <Suspense fallback={<BuilderFallback />}>
      <LazyPipelineBuilder />
    </Suspense>
  );
}
