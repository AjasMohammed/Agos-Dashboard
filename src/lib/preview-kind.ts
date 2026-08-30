import type { FileMeta } from "@/api/models";

/**
 * How a stored file can be shown in-panel. Kept out of the component module so
 * the test can import it without tripping the fast-refresh rule.
 *
 * SECURITY: there is deliberately no `html` kind. Uploads are untrusted, so
 * `text/html` previews as source in a <pre>, never as markup — rendering an
 * uploaded document is the stored-XSS path that `/artifacts` guards with its
 * `artifact` tag + sandboxed iframe.
 */
export type PreviewKind = "text" | "markdown" | "image" | "pdf" | "none";

const TEXT_MIME = /^application\/(json|xml|yaml|x-yaml|javascript|x-sh|x-www-form-urlencoded|.*\+json|.*\+xml)$/;
const TEXT_EXT = /\.(md|markdown|txt|log|csv|tsv|json|ya?ml|toml|ini|cfg|conf|xml|html?|css|jsx?|tsx?|py|rs|go|sh|sql)$/;

export function previewKind(meta: Pick<FileMeta, "mime" | "name" | "original_name">): PreviewKind {
  const mime = (meta.mime ?? "").toLowerCase();
  const name = (meta.original_name || meta.name || "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/markdown" || name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (mime.startsWith("text/") || TEXT_MIME.test(mime)) return "text";
  // The kernel stores plenty of rows as application/octet-stream (anything the
  // uploader could not sniff), so fall back to the extension before giving up.
  return TEXT_EXT.test(name) ? "text" : "none";
}
