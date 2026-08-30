/**
 * Human title for a task prompt. Kernel-generated prompts start with bracketed
 * context blocks (`[SYSTEM CONTEXT]`, `[EVENT NOTIFICATION]`, `[ONBOARDING — …]`)
 * that are noise in a list; surface the first meaningful line instead.
 */
export function taskTitle(prompt: string | null | undefined, max = 120): string {
  if (!prompt) return "";
  const lines = prompt.split("\n").map((l) => l.trim());
  // An unterminated bracket is a header cut off by the preview limit, not content.
  const isHeader = (l: string) => /^\[[^\]]*\]?$/.test(l);
  const isNoise = (l: string) =>
    l === "" || isHeader(l) || /^You are [\w-]+(,| operating| —)/.test(l);
  const first = lines.find((l) => !isNoise(l));
  // Fall back to the first header if the prompt is nothing but headers.
  const title = first ?? lines.find((l) => l !== "") ?? "";
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}
