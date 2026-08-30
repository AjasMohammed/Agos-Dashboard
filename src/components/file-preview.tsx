import { useCallback, useEffect, useState } from "react";
import { FileQuestion, type LucideIcon, FileText, Code2, LayoutTemplate, Image as ImageIcon, FileType } from "lucide-react";
import { authedFetch } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { bytes } from "@/lib/format";
import { artifactKind, isArtifact } from "@/lib/artifact-kind";
import { previewKind, type PreviewKind } from "@/lib/preview-kind";
import type { FileMeta } from "@/api/models";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/** Held in memory to render — bigger than this stays download-only. */
const MAX_PREVIEW = 4 * 1024 * 1024;
/** A card thumbnail is worth far fewer bytes than a full preview. */
const MAX_THUMB = { text: 256 * 1024, binary: 2 * 1024 * 1024 };

type Bytes = { text?: string; url?: string; error?: string };

/**
 * The file's body, as text or as an object URL, fetched once `enabled` turns
 * true. Shared by the full preview and the card thumbnail so the auth, the
 * blob typing and the revoke-on-unmount all live in one place.
 */
function useFileBytes(file: FileMeta, kind: PreviewKind, enabled: boolean): Bytes | undefined {
  const [state, setState] = useState<Bytes>();
  useEffect(() => {
    if (!enabled) return;
    let url: string | undefined;
    let cancelled = false;
    setState(undefined);
    // `timeoutMs: null` — same reason as the download: the default 30s deadline
    // aborts mid-body and surfaces as a bare AbortError.
    authedFetch(`${API_BASE}/api/v1/files/${file.id}/download`, {}, null)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not read file (${res.status})`);
        if (kind === "image" || kind === "pdf") {
          // Type the blob from the registry mime, not from the response: a blob
          // URL is served with exactly this type and is never content-sniffed,
          // so a stored .html can't be talked into rendering as a document.
          url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: file.mime }));
          if (cancelled) return URL.revokeObjectURL(url);
          setState({ url });
        } else {
          const text = await res.text();
          if (!cancelled) setState({ text });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id, file.mime, kind, enabled]);
  return state;
}

/** True once the element has scrolled into view — it never flips back. */
function useInView() {
  const [seen, setSeen] = useState(false);
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el || seen) return;
      // IntersectionObserver is missing in jsdom (and any pre-2019 browser);
      // showing every thumbnail beats showing none.
      if (typeof IntersectionObserver === "undefined") return setSeen(true);
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setSeen(true);
            io.disconnect();
          }
        },
        { rootMargin: "200px" },
      );
      io.observe(el);
    },
    [seen],
  );
  return [ref, seen] as const;
}

/** An agent-published HTML document — the only body ever rendered as markup. */
function isHtmlArtifact(file: FileMeta) {
  return isArtifact(file) && artifactKind(file) === "html";
}

const KIND_ICON: Record<PreviewKind, LucideIcon> = {
  image: ImageIcon,
  pdf: FileType,
  markdown: FileText,
  text: Code2,
  none: FileQuestion,
};

/**
 * Card thumbnail. Fetches nothing until the card is on screen, and skips
 * anything too big to be worth a thumbnail — a file list can be long.
 */
export function FileThumb({ file }: { file: FileMeta }) {
  const [ref, inView] = useInView();
  const html = isHtmlArtifact(file);
  const kind = previewKind(file);
  const cap = kind === "image" || kind === "pdf" ? MAX_THUMB.binary : MAX_THUMB.text;
  const enabled = inView && kind !== "none" && file.size <= cap;
  const state = useFileBytes(file, kind, enabled);
  const Icon = html ? LayoutTemplate : KIND_ICON[kind];

  return (
    <div ref={ref} className="relative h-36 w-full overflow-hidden bg-muted/30">
      {state?.url ? (
        kind === "pdf" ? (
          // Chrome's PDF viewer refuses to load in a sandboxed frame; the blob is
          // pinned to application/pdf above, so it is handed to the viewer rather
          // than parsed as a document. Inert — the card owns the click.
          <iframe
            title=""
            aria-hidden
            tabIndex={-1}
            src={`${state.url}#toolbar=0&navpanes=0&view=FitH`}
            className="pointer-events-none h-full w-full"
          />
        ) : (
          <img src={state.url} alt="" className="h-full w-full object-cover" />
        )
      ) : state?.text != null ? (
        html ? (
          // Same sandbox rule as the full artifact view: no `allow-same-origin`,
          // so agent-authored script gets an opaque origin and cannot reach the
          // panel's DOM or its API key. Scaled down to fit the card.
          <iframe
            title=""
            aria-hidden
            tabIndex={-1}
            srcDoc={state.text}
            sandbox="allow-scripts"
            className="pointer-events-none h-[400px] w-[800px] origin-top-left scale-[0.36] bg-white"
          />
        ) : kind === "markdown" ? (
          // Rendered, not raw: a report thumbnail reading `**Status:**` looks
          // broken. Only the first page's worth is parsed.
          <div className="h-full w-full overflow-hidden p-3 text-[11px] leading-snug">
            <Markdown>{state.text.slice(0, 800)}</Markdown>
          </div>
        ) : (
          <pre className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-snug text-muted-foreground">
            {state.text.slice(0, 800)}
          </pre>
        )
      ) : enabled && !state?.error ? (
        <Skeleton className="h-full w-full rounded-none" />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Icon className="size-8 text-muted-foreground/50" />
        </div>
      )}
      {/* Fades the hard cut where the snippet or page runs past the card. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent" />
    </div>
  );
}

/**
 * In-panel look at a stored file: text/markdown inline, images and PDFs through
 * an object URL. Binary bytes never reach `srcDoc`/`innerHTML` — see the
 * security note on {@link previewKind}.
 */
export function FilePreview({ file }: { file: FileMeta }) {
  const kind = previewKind(file);
  const skip = kind === "none" || file.size > MAX_PREVIEW;
  const state = useFileBytes(file, kind, !skip);

  if (skip) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="No preview"
        description={
          kind === "none"
            ? `${file.mime || "This file type"} can't be shown here — download it instead.`
            : `Too large to preview (${bytes(file.size)}) — download it instead.`
        }
      />
    );
  }
  if (state?.error) return <p className="py-8 text-center text-sm text-destructive">{state.error}</p>;
  if (!state) return <Skeleton className="h-64 w-full" />;
  if (state.url) {
    return kind === "pdf" ? (
      // No `sandbox`: Chrome's PDF viewer refuses to load in a sandboxed frame,
      // and the blob is pinned to application/pdf above, so it is handed to the
      // viewer rather than parsed as a document.
      <iframe title={file.original_name || file.name} src={state.url} className="h-[65vh] w-full rounded-md border border-border" />
    ) : (
      <img src={state.url} alt={file.original_name || file.name} className="mx-auto max-h-[65vh] rounded-md border border-border bg-muted" />
    );
  }
  return kind === "markdown" ? (
    <div className="max-h-[65vh] overflow-auto rounded-md border border-border p-4">
      <Markdown className="text-sm">{state.text ?? ""}</Markdown>
    </div>
  ) : (
    <pre className="max-h-[65vh] overflow-auto rounded-md border border-border bg-foreground/5 p-4 font-mono text-xs whitespace-pre-wrap break-words">
      {state.text}
    </pre>
  );
}
