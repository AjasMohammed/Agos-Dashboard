import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAuthStore } from "@/auth/store";
import { ApiError } from "@/api/client";
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

/** Flush the async ticket-mint step inside open() (microtasks under fake timers). */
const flushOpen = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  __test.reset();
  FakeWS.instances = [];
  __test.setSocketFactory((url) => new FakeWS(url) as unknown as WebSocket);
  __test.setTicketFetcher(async () => "tkt-test");
  useAuthStore.getState().setSession({ apiKey: "k1", scopes: [] });
});

afterEach(() => {
  vi.useRealTimers();
  __test.reset();
  useAuthStore.getState().clear();
});

describe("realtime connection", () => {
  it("connects, opens, and flushes queued frames", async () => {
    sendFrame({ type: "ping" }); // queued before the socket exists
    connectRealtime();
    expect(useRealtimeStatus.getState().status).toBe("connecting");
    await flushOpen();
    const ws = FakeWS.instances[0];
    ws.fireOpen();
    expect(useRealtimeStatus.getState().status).toBe("open");
    expect(ws.sent).toContain(JSON.stringify({ type: "ping" }));
  });

  it("authenticates with a single-use ticket, not the raw key", async () => {
    connectRealtime();
    await flushOpen();
    expect(FakeWS.instances[0].url).toContain("ticket=tkt-test");
    expect(FakeWS.instances[0].url).not.toContain("token=");
  });

  it("falls back to ?token= against kernels without the ticket endpoint", async () => {
    __test.setTicketFetcher(async () => {
      throw new ApiError(404, "NOT_FOUND", "no such route");
    });
    connectRealtime();
    await flushOpen();
    expect(FakeWS.instances[0].url).toContain("token=k1");
    expect(FakeWS.instances[0].url).not.toContain("ticket=");
  });

  it("retries with backoff when the ticket mint fails transiently", async () => {
    __test.setTicketFetcher(async () => {
      throw new Error("network down");
    });
    connectRealtime();
    await flushOpen();
    expect(FakeWS.instances.length).toBe(0);
    expect(useRealtimeStatus.getState().status).toBe("reconnecting");
    // Mint recovers; the scheduled retry should connect.
    __test.setTicketFetcher(async () => "tkt-2");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(FakeWS.instances.length).toBe(1);
    expect(FakeWS.instances[0].url).toContain("ticket=tkt-2");
  });

  it("reconnects with backoff after an unexpected close", async () => {
    connectRealtime();
    await flushOpen();
    FakeWS.instances[0].fireOpen();
    FakeWS.instances[0].close(); // unexpected drop, key still present
    expect(useRealtimeStatus.getState().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(31_000); // exceed max backoff window
    expect(FakeWS.instances.length).toBe(2);
  });

  it("does not reconnect after an intentional disconnect", async () => {
    connectRealtime();
    await flushOpen();
    FakeWS.instances[0].fireOpen();
    disconnectRealtime();
    expect(useRealtimeStatus.getState().status).toBe("closed");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(FakeWS.instances.length).toBe(1);
  });

  it("does not open a socket when logout lands during the mint", async () => {
    let resolveTicket: (t: string) => void = () => {};
    __test.setTicketFetcher(() => new Promise((r) => (resolveTicket = r)));
    connectRealtime();
    useAuthStore.getState().clear(); // logout while the mint is in flight
    resolveTicket("tkt-late");
    await flushOpen();
    expect(FakeWS.instances.length).toBe(0);
  });
});
