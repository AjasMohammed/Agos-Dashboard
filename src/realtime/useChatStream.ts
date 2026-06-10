import { useCallback, useEffect, useState } from "react";
import { addFrameListener, sendFrame } from "./connection";

export interface ChatStreamState {
  streaming: boolean;
  /** Accumulated assistant text from `chat.chunk` deltas. */
  text: string;
  toolCalls: unknown[];
  error: string | null;
}

const EMPTY: ChatStreamState = { streaming: false, text: "", toolCalls: [], error: null };

/**
 * Chat streaming over the WS `chat.send` / `chat.chunk` / `chat.done` /
 * `chat.cancel` frames for one session. Accumulates deltas in order, resolves on
 * `chat.done`, and supports cancellation. Reused by the conversational pages
 * (plan phase 12).
 */
export function useChatStream(sessionId: string | null) {
  const [state, setState] = useState<ChatStreamState>(EMPTY);

  useEffect(() => {
    if (!sessionId) return;
    setState(EMPTY);
    return addFrameListener((frame) => {
      // Frames carrying a session_id for a different session are not ours.
      if ("session_id" in frame && frame.session_id !== sessionId) return;
      switch (frame.type) {
        case "chat.chunk":
          setState((s) => ({ ...s, streaming: true, text: s.text + frame.delta }));
          break;
        case "chat.done":
          setState((s) => ({ ...s, streaming: false, toolCalls: frame.tool_calls }));
          break;
        case "chat.cancelled":
          setState((s) => ({ ...s, streaming: false }));
          break;
        case "error":
          setState((s) => (s.streaming ? { ...s, streaming: false, error: frame.message } : s));
          break;
        default:
          break;
      }
    });
  }, [sessionId]);

  const send = useCallback(
    (message: string, agentName?: string) => {
      if (!sessionId) return;
      setState({ streaming: true, text: "", toolCalls: [], error: null });
      sendFrame({ type: "chat.send", session_id: sessionId, message, agent_name: agentName });
    },
    [sessionId],
  );

  const cancel = useCallback(() => {
    if (!sessionId) return;
    sendFrame({ type: "chat.cancel", session_id: sessionId });
  }, [sessionId]);

  return { ...state, send, cancel };
}
