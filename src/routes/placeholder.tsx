import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

/**
 * Stub for a feature area. Real pages land in plan phases 11–15; until then this
 * confirms routing, the shell, scope-gating, and the loading boundary all work.
 */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Construction className="text-muted-foreground" />
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>This area is scaffolded — the page lands in a later phase.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The route, navigation, scope-gating, and shell are wired. Feature UI for
          <span className="font-medium text-foreground"> {title}</span> is implemented in
          plan phases 11–15.
        </CardContent>
      </Card>
    </div>
  );
}
