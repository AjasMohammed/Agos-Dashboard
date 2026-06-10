import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// remark-breaks renders single newlines as line breaks (chat-style), matching the
// whitespace-pre-wrap behavior plain-text agent replies relied on before.
const plugins = [remarkGfm, remarkBreaks];

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
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
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
};

/**
 * Renders agent/assistant markdown inside a chat bubble. Styles are scoped via
 * component overrides (not the typography plugin) so they inherit the bubble's
 * text color and stay compact at text-sm. Memoized so settled messages don't
 * re-parse while a new reply streams in.
 */
export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2 break-words", className)}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
