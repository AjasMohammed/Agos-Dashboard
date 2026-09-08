import { toast } from "sonner";
import { addFrameListener, onReconnect, sendFrame } from "./connection";
import { channelMatches, type EventFrame, type ServerFrame } from "./protocol";

export type ChannelHandler = (event: EventFrame) => void;

interface ChannelState {
  handlers: Set<ChannelHandler>;
  subscriptionId?: string;
  /**
   * The last handler left before the `subscribed` ack arrived, so there is no
   * `subscription_id` to release with yet. The entry is kept alive and the ack
   * handler sends the `unsubscribe` — dropping it here would leak the
   * subscription for the life of the socket (the server caps at 64, then
   * rejects further subscribes). StrictMode's double mount and any fast nav
   * hit this window routinely.
   */
  pendingUnsubscribe?: boolean;
}

const channels = new Map<string, ChannelState>();
let attached = false;
/**
 * Error codes already surfaced. The error frame names no channel, so a refused
 * subscribe cannot be dropped from `resubscribeAll` — but it can at least stop
 * re-toasting on every reconnect for the life of the session.
 */
const warned = new Set<string>();

function onFrame(frame: ServerFrame) {
  if (frame.type === "subscribed") {
    const state = channels.get(frame.channel);
    if (!state) return;
    if (state.pendingUnsubscribe || state.handlers.size === 0) {
      // Everyone left while the ack was in flight — release it immediately
      // now that we finally have an id to release with.
      sendFrame({ type: "unsubscribe", subscription_id: frame.subscription_id });
      channels.delete(frame.channel);
      return;
    }
    state.subscriptionId = frame.subscription_id;
    return;
  }
  if (frame.type === "error") {
    // The server rejects subscribes it cannot serve (missing scope, the 64-sub
    // cap, a stale id). Silently swallowing those leaves a green connection
    // badge over a UI that receives nothing — indistinguishable from idle.
    console.warn(`realtime error frame [${frame.code}]: ${frame.message}`);
    if ((frame.code === "FORBIDDEN" || frame.code === "SUBSCRIPTION_LIMIT") && !warned.has(frame.code)) {
      warned.add(frame.code);
      // Same id per code so a burst across channels collapses into one toast.
      toast.error(`Live updates unavailable: ${frame.message}`, { id: `ws-${frame.code}` });
    }
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
  for (const [channel, state] of channels) {
    if (state.pendingUnsubscribe) {
      // No listeners, and the subscription it was waiting on died with the old
      // socket — nothing to release, just forget it.
      channels.delete(channel);
      continue;
    }
    // Ids belong to the socket that issued them; keeping a dead one would make
    // a teardown before the new ack send a bogus `unsubscribe` and drop the
    // entry, leaking the subscription we are re-establishing right here.
    state.subscriptionId = undefined;
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
  // A re-subscribe inside the ack round trip (StrictMode remount) cancels a
  // pending release: the in-flight subscription is exactly the one we want.
  state.pendingUnsubscribe = false;
  state.handlers.add(handler);

  return () => {
    const current = channels.get(channel);
    if (!current) return;
    current.handlers.delete(handler);
    if (current.handlers.size > 0) return;
    if (current.subscriptionId) {
      sendFrame({ type: "unsubscribe", subscription_id: current.subscriptionId });
      channels.delete(channel);
    } else {
      // Ack still in flight — `onFrame` finishes the teardown.
      current.pendingUnsubscribe = true;
    }
  };
}

export const __test = {
  reset() {
    channels.clear();
    warned.clear();
    attached = false;
  },
  activeChannels: () => [...channels.keys()],
  handlerCount: (channel: string) => channels.get(channel)?.handlers.size ?? 0,
};
