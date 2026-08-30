import { describe, expect, it } from "vitest";
import { partialMatchKey } from "@tanstack/react-query";
import * as agentChats from "./agent-chats";
import * as agents from "./agents";
import * as automation from "./automation";
import * as chat from "./chat";
import * as dashboard from "./dashboard";
import * as extensibility from "./extensibility";
import * as governance from "./governance";
import * as notifications from "./notifications";
import * as system from "./system";
import * as tasks from "./tasks";
import * as tools from "./tools";

/**
 * `invalidateQueries` matches by prefix and defaults to `cancelRefetch: true`,
 * swallowing the cancellation. So if key A is a prefix of key B, invalidating A
 * silently aborts B's in-flight fetch — which is how the chat session list used
 * to kill the message refetch mid-stream and drop the live reply bubble.
 *
 * The key table below is built by **enumerating the modules**, not by hand: any
 * export named `*Key`/`*Keys` is walked and every member (array, or factory
 * called with sentinels) becomes a row. A new factory therefore joins these
 * checks without anyone remembering to list it — the earlier hand-written
 * allowlist had missed `connectorKeys`/`pluginKeys` detail lookups, the
 * scratchpad page key, task traces and checkpoints, audit and marketplace.
 *
 * The corollary: a key built inline at a `useQuery` call is invisible here, so
 * every key in `src/api/queries` is declared in a factory. Keep it that way.
 */
const MODULES: object[] = [
  agentChats,
  agents,
  automation,
  chat,
  dashboard,
  extensibility,
  governance,
  notifications,
  system,
  tasks,
  tools,
];

type Key = readonly unknown[];

/** Distinct per argument position, so two factories can't coincide by accident. */
const SENTINELS = ["«0»", "«1»", "«2»"];

function collectKeys(): Record<string, Key> {
  const out: Record<string, Key> = {};
  for (const mod of MODULES) {
    for (const [exportName, exported] of Object.entries(mod)) {
      if (!/Keys?$/.test(exportName)) continue;
      if (Array.isArray(exported)) {
        out[exportName] = exported as Key;
        continue;
      }
      // Skips the `useApiKeys`-style hooks the name filter also matches.
      if (typeof exported !== "object" || exported === null) continue;
      for (const [member, value] of Object.entries(exported as object)) {
        const label = `${exportName}.${member}`;
        if (Array.isArray(value)) {
          out[label] = value as Key;
        } else if (typeof value === "function") {
          const factory = value as unknown as (...args: string[]) => Key;
          out[label] = factory(...SENTINELS.slice(0, factory.length));
        }
      }
    }
  }
  return out;
}

const KEYS = collectKeys();

/**
 * True when `invalidateQueries({ queryKey: parent })` would also match a query
 * keyed `child`. This is the client's own matcher rather than a re-implementation
 * — notably it matches object segments **partially** (`["tasks","list",{}]`
 * covers `["tasks","list",{status:"failed"}]`), which a segment-wise string
 * comparison gets wrong.
 */
function invalidates(parent: Key, child: Key): boolean {
  return partialMatchKey(child, parent);
}

/**
 * Parent key → the keys its prefix invalidation is *meant* to reach.
 *
 * Any relation not listed here fails the test, because an undeclared one means a
 * broad invalidation is cancelling an unrelated in-flight fetch. Adding a row is
 * a decision — "these really should refresh together" — not a way to quiet the
 * test; the alternative is to make the two keys disjoint.
 */
const INTENDED: Record<string, string[]> = {
  // The deliberate "anything about this agent changed" root.
  "agentKeys.root": [
    "agentKeys.all",
    "agentKeys.costs",
    "agentKeys.detail",
    "agentKeys.identity",
    "agentKeys.inbox",
    "agentKeys.memory",
    "agentKeys.scratchPage",
    "agentKeys.scratchpad",
  ],
  // Every agent sub-resource hangs off `detail` so one agent has exactly one
  // cache namespace. The profile mutations that must NOT fan out into it pass
  // `exact: true` (see `invalidateAgentProfile`).
  "agentKeys.detail": [
    "agentKeys.costs",
    "agentKeys.identity",
    "agentKeys.inbox",
    "agentKeys.memory",
    "agentKeys.scratchPage",
    "agentKeys.scratchpad",
  ],
  // Saving/deleting a page refreshes the page list and the page itself in one
  // call — the narrower invalidation would be redundant.
  "agentKeys.scratchpad": ["agentKeys.scratchPage"],
  "scratchpadKeys.all": ["scratchpadKeys.page"],
  // A conversation summary and its transcript are one thing to the operator.
  "convoKeys.all": ["convoKeys.detail"],
  // A toggle/mutation refreshes the list *and* the open detail dialog, which is
  // showing the status that just changed.
  "connectorKeys.all": ["connectorKeys.detail"],
  "pluginKeys.all": ["pluginKeys.detail"],
  "skillKeys.all": ["skillKeys.detail"],
  // Marking one notification read changes the unread badge.
  "notificationKeys.all": ["notificationKeys.unread"],
  // Run/cancel/resume invalidate the whole task family: the list row, the detail
  // header, and the trace/checkpoints that just changed underneath them.
  "taskKeys.all": ["taskKeys.checkpoints", "taskKeys.detail", "taskKeys.list", "taskKeys.trace"],
  "taskKeys.detail": ["taskKeys.checkpoints", "taskKeys.trace"],
};

describe("query keys", () => {
  it("enumerates the declared key factories", () => {
    // Without this a typo in the name filter would empty the table and turn
    // every check below into a silent no-op.
    expect(Object.keys(KEYS)).toEqual(
      expect.arrayContaining([
        "agentKeys.detail",
        "chatKeys.messages",
        "dashboardKey",
        "taskKeys.checkpoints",
      ]),
    );
    expect(Object.keys(KEYS).length).toBeGreaterThan(40);
  });

  it("every prefix relation between keys is a declared, intended one", () => {
    const found: Record<string, string[]> = {};
    for (const [parentName, parent] of Object.entries(KEYS)) {
      for (const [childName, child] of Object.entries(KEYS)) {
        if (parentName === childName) continue;
        if (invalidates(parent, child)) (found[parentName] ??= []).push(childName);
      }
    }
    for (const children of Object.values(found)) children.sort();
    expect(found).toEqual(INTENDED);
  });

  it("matches object segments partially, the way the client does", () => {
    // An unfiltered list key really is a prefix of every filtered one, so
    // invalidating `taskKeys.list({})` reaches them all. Comparing stringified
    // segments claimed the opposite.
    expect(invalidates(tasks.taskKeys.list({}), tasks.taskKeys.list({ status: "failed" }))).toBe(
      true,
    );
    expect(invalidates(tasks.taskKeys.list({ status: "failed" }), tasks.taskKeys.list({}))).toBe(
      false,
    );
  });

  it("keeps the chat session list out of the message key's path", () => {
    // The exact regression: invalidating the session list at the end of a turn
    // must not cancel the transcript refetch it is awaiting.
    const id = "11111111-2222-3333-4444-555555555555";
    expect(invalidates(chat.chatKeys.sessions, chat.chatKeys.messages(id))).toBe(false);
    expect(invalidates(agents.agentKeys.all, agents.agentKeys.detail("alpha"))).toBe(false);
  });
});
