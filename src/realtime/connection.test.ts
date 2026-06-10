import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAuthStore } from "@/auth/store";
import {
  connectRealtime,
  disconnectRealtime,
  sendFrame,
  useRealtimeStatus,
  __test,
} from "./connection";

/** Minimal fake WebSocket capturing the lifecycle callbacks. */
class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  fireOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  __test.reset();
  FakeWS.instances = [];
  __test.setSocketFactory((url) => new FakeWS(url) as unknown as WebSocket);
  useAuthStore.getState().setSession({ apiKey: "k1", scopes: [] });
});

afterEach(() => {
  vi.useRealTimers();
  __test.reset();
  useAuthStore.getState().clear();
});

describe("realtime connection", () => {
  it("connects, opens, and flushes queued frames", () => {
    sendFrame({ type: "ping" }); // queued before the socket exists
    connectRealtime();
    expect(useRealtimeStatus.getState().status).toBe("connecting");
    const ws = FakeWS.instances[0];
    ws.fireOpen();
    expect(useRealtimeStatus.getState().status).toBe("open");
    expect(ws.sent).toContain(JSON.stringify({ type: "ping" }));
  });

  it("reconnects with backoff after an unexpected close", () => {
    connectRealtime();
    FakeWS.instances[0].fireOpen();
    FakeWS.instances[0].close(); // unexpected drop, key still present
    expect(useRealtimeStatus.getState().status).toBe("reconnecting");
    vi.advanceTimersByTime(31_000); // exceed max backoff window
    expect(FakeWS.instances.length).toBe(2);
  });

  it("does not reconnect after an intentional disconnect", () => {
    connectRealtime();
    FakeWS.instances[0].fireOpen();
    disconnectRealtime();
    expect(useRealtimeStatus.getState().status).toBe("closed");
    vi.advanceTimersByTime(31_000);
    expect(FakeWS.instances.length).toBe(1);
  });
});
