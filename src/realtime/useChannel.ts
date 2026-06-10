import { useEffect, useRef } from "react";
import { subscribe, type ChannelHandler } from "./subscriptions";

/**
 * Subscribe to a realtime `channel` for the lifetime of the component. The
 * handler is kept in a ref so updating it does not re-subscribe; only a changed
 * `channel` does. Pass `null`/`undefined` to skip (e.g. id not ready yet).
 */
export function useChannel(channel: string | null | undefined, handler: ChannelHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!channel) return;
    return subscribe(channel, (event) => handlerRef.current(event));
  }, [channel]);
}
