/**
 * Flatten markdown to plain text for one-line previews (chat rail, "last
 * message"). Not a parser: strips the common inline/block syntax so `**bold**`,
 * headings, code, links and images read as their text. The transcript itself
 * still renders through `<Markdown>`.
 */
export function stripMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  // Rail previews are one line; cap before the regex passes.
  text = text.slice(0, 300);
  return (
    text
      // fenced code: keep the body, drop the fences
      .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
      // images → alt, links → label
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // headings, blockquotes, list markers at line start
      .replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+\.[ \t]+)/gm, "")
      // horizontal rules
      .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, "")
      // emphasis / strikethrough / inline code
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      // html tags
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}
