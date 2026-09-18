import type { ConvoTurn } from "@/api/models";

/** Speaker name the API stores on rows the operator posts (not a legal agent name). */
export const USER_SPEAKER = "@user";

/**
 * Conversations created by the old client-side "continue" carried the previous
 * transcript in their topic, so only the first line is title — list rows and the
 * pane header show just that.
 */
export function titleOf(topic: string): string {
  return topic.split("\n", 1)[0];
}

/**
 * Who speaks next, by the runner's own rotation: the participant after the last
 * agent that spoke (operator rows don't count), else the first. Used when no
 * live frame has arrived — socket down, or the page opened mid-turn.
 */
export function nextSpeaker(
  participants: string[],
  messages: Pick<ConvoTurn, "agent_name">[],
): string | undefined {
  const last = [...messages].reverse().find((m) => m.agent_name !== USER_SPEAKER);
  const i = last ? participants.indexOf(last.agent_name) : -1;
  return participants[(i + 1) % participants.length];
}
