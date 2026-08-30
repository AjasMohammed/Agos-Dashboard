/**
 * Human verb phrase for a tool name, for chat tool cards. Exact match wins over
 * prefix; unknown tools fall back to their raw name so nothing is ever hidden.
 *
 * ponytail: a map + prefix list, no icon registry — every card uses the same
 * wrench icon. Add per-verb icons only if someone asks.
 */
const EXACT: Record<string, string> = {
  "web-search": "Searched the web",
  "web-fetch": "Fetched a web page",
  "file-reader": "Read a file",
  "user-file-reader": "Read your file",
  "file-writer": "Wrote a file",
  "file-editor": "Edited a file",
  "shell-exec": "Ran a command",
  "ask-user": "Asked you a question",
  "notify-user": "Sent you a note",
  "artifact-write": "Made something to look at",
  datetime: "Checked the time",
  think: "Thought it through",
  "data-parser": "Parsed some data",
};

const PREFIX: [string, string][] = [
  ["schedule-", "Set up a schedule"],
  ["memory-", "Checked memory"],
  ["scratch-", "Updated its notes"],
  ["file-", "Worked with a file"],
  ["event-", "Managed an event subscription"],
  ["agent-", "Talked to another assistant"],
  ["system-", "Inspected the system"],
  ["network-", "Checked the network"],
  ["procedure-", "Checked a saved procedure"],
];

export function toolVerb(name: string): string {
  if (name in EXACT) return EXACT[name];
  const hit = PREFIX.find(([p]) => name.startsWith(p));
  return hit ? hit[1] : name;
}
