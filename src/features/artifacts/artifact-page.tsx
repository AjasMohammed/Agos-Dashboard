import { useParams } from "@tanstack/react-router";
import { FileText, LayoutTemplate, Code2 } from "lucide-react";
import { useArtifact, useFiles } from "@/api/queries/system";
import { PageHeader } from "@/components/page-header";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/empty-state";
import { FilePreview, FileThumb } from "@/components/file-preview";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { bytes, relativeTime } from "@/lib/format";
import { artifactKind, isArtifact } from "@/lib/artifact-kind";

/**
 * Agents publish deliverables with `artifact-write`, which stores a `FileStore`
 * row tagged `artifact,kind:<html|markdown|slides>,agent:<id>` and hands the
 * agent a **relative** `/artifacts/<id>` link. `agentos-web` has served that
 * route since the artifacts feature landed; the panel never did, so every link
 * an agent emitted in panel chat 404'd. Same URL, same bytes — read through
 * `GET /api/v1/files/{id}` + `/download`, which is all the API this needs.
 */

const KIND_ICON = { html: Code2, markdown: FileText, slides: LayoutTemplate } as const;

export function ArtifactPage() {
  const { id } = useParams({ from: "/app/artifacts/$id" });
  const query = useArtifact(id);
  return (
    <div className="mx-auto w-full max-w-4xl">
      <QueryState query={query}>
        {({ meta, text }) => {
          // The `artifact` tag is load-bearing, not decoration: without this
          // check any uploaded .html could be rendered through the html branch
          // below, which is the stored-XSS path the whole feature is built to
          // avoid. Plain files keep their download-only treatment on /files.
          if (!isArtifact(meta)) {
            return (
              <>
                <PageHeader
                  title={meta.original_name || meta.name}
                  description={`Not an artifact — ${meta.mime} · ${bytes(meta.size)} · ${relativeTime(meta.uploaded_at)}`}
                  actions={
                    <Button asChild variant="outline" size="sm">
                      {/* Section routes are built from NAV_ITEMS, so they are absent from the
                          router's generated path union — same cast the dashboard redirect uses. */}
                      <Link to={"/files" as string}>Open in Files</Link>
                    </Button>
                  }
                />
                {/* A plain upload still gets the read-only preview — it just never
                    reaches the srcDoc branch below. */}
                <FilePreview file={meta} />
              </>
            );
          }
          const kind = artifactKind(meta);
          return (
            <>
              <PageHeader
                title={meta.original_name || meta.name}
                description={`${kind} · ${bytes(meta.size)} · ${relativeTime(meta.uploaded_at)}`}
                actions={<Badge variant="muted">{kind}</Badge>}
              />
              {kind === "html" ? (
                // `sandbox` WITHOUT `allow-same-origin`: the frame gets a unique
                // opaque origin, so agent-authored script cannot read the
                // panel's DOM, its sessionStorage API key, or any cookie. This
                // mirrors the server viewer's CSP `sandbox allow-scripts` —
                // never add allow-same-origin here.
                <iframe
                  title={meta.original_name || "Artifact"}
                  srcDoc={text}
                  sandbox="allow-scripts"
                  className="h-[calc(100vh-16rem)] w-full rounded-md border border-border bg-white"
                />
              ) : (
                <Card>
                  <CardContent className="p-6">
                    {/* ponytail: slides render as one scrolling markdown document
                        (the `---` separators become rules). Deck navigation lives
                        in the server viewer; port it if anyone asks. */}
                    <Markdown className="text-sm">{text}</Markdown>
                  </CardContent>
                </Card>
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

export function ArtifactsPage() {
  const query = useFiles();
  return (
    <div>
      <PageHeader
        title="Artifacts"
        description="Reports, dashboards and decks published by agents."
      />
      <QueryState
        query={query}
        isEmpty={(d) => !d.items.some(isArtifact)}
        empty={
          <EmptyState
            icon={FileText}
            title="No artifacts yet"
            description="When an agent publishes a report or dashboard it shows up here."
          />
        }
      >
        {(d) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...d.items.filter(isArtifact)]
              .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
              .map((f) => {
                const kind = artifactKind(f);
                const Icon = KIND_ICON[kind];
                return (
                  <Link key={f.id} to="/artifacts/$id" params={{ id: f.id }} className="group">
                    <Card className="flex h-full flex-col overflow-hidden group-hover:shadow-md">
                      <FileThumb file={f} />
                      <div className="flex flex-1 flex-col gap-1 border-t border-border p-3">
                        <p className="flex items-center gap-2 truncate text-sm font-medium group-hover:underline" title={f.original_name || f.name}>
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{f.original_name || f.name}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {bytes(f.size)} · {relativeTime(f.uploaded_at)}
                        </p>
                        <div className="pt-1">
                          <Badge variant="muted">{kind}</Badge>
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
          </div>
        )}
      </QueryState>
    </div>
  );
}
