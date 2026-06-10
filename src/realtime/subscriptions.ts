import { addFrameListener, onReconnect, sendFrame } from "./connection";
import { channelMatches, type EventFrame, type ServerFrame } from "./protocol";

export type ChannelHandler = (event: EventFrame) => void;

interface ChannelState {
  handlers: Set<ChannelHandler>;
  subscriptionId?: string;
}

const channels = new Map<string, ChannelState>();
let attached = false;

function onFrame(frame: ServerFrame) {
  if (frame.type === "subscribed") {
    const state = channels.get(frame.channel);
    if (state) state.subscriptionId = frame.subscription_id;
    return;
  }
  if (frame.type === "event") {
    for (const [channel, state] of channels) {
      if (channelMatches(channel, frame.channel)) {
        state.handlers.forEach((handler) => handler(frame));
      }
    }
  }
}

/** Re-send a subscribe frame for every active channel after a reconnect. */
function resubscribeAll() {
  for (const channel of channels.keys()) {
    sendFrame({ type: "subscribe", channel });
  }
}

function ensureAttached() {
  if (attached) return;
  attached = true;
  addFrameListener(onFrame);
  onReconnect(resubscribeAll);
}

/**
 * Subscribe `handler` to `channel`. Reference-counted: a `subscribe` frame is
 * sent only for the first handler on a channel, and `unsubscribe` only when the
 * last handler leaves. Returns a teardown function.
 */
export function subscribe(channel: string, handler: ChannelHandler): () => void {
  ensureAttached();
  let state = channels.get(channel);
  if (!state) {
    state = { handlers: new Set() };
    channels.set(channel, state);
    sendFrame({ type: "subscribe", channel });
  }
  state.handlers.add(handler);

  return () => {
    const current = channels.get(channel);
    if (!current) return;
    current.handlers.delete(handler);
    if (current.handlers.size === 0) {
      if (current.subscriptionId) {
        sendFrame({ type: "unsubscribe", subscription_id: current.subscriptionId });
      }
      channels.delete(channel);
    }
  };
}

export const __test = {
  reset() {
    channels.clear();
    attached = false;
  },
  activeChannels: () => [...channels.keys()],
  handlerCount: (channel: string) => channels.get(channel)?.handlers.size ?? 0,
};
