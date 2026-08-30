import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useQuery,
} from "@tanstack/react-query";
import { QueryState } from "./query-state";

/** Never settles — pins the enabled case to "first fetch in flight", no timers. */
const NEVER = new Promise<string[]>(() => undefined);

function Harness({ enabled }: { enabled: boolean }) {
  const query = useQuery({
    queryKey: ["query-state-test", enabled],
    queryFn: () => NEVER,
    enabled,
  });
  return (
    <QueryState
      query={query}
      skeleton={<div data-testid="skeleton" />}
      empty={<div data-testid="empty" />}
      idle={<div data-testid="idle" />}
      isEmpty={(rows) => rows.length === 0}
    >
      {(rows) => <div data-testid="data">{rows.length}</div>}
    </QueryState>
  );
}

function renderHarness(enabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness enabled={enabled} />
    </QueryClientProvider>,
  );
}

afterEach(() => onlineManager.setOnline(true));

describe("QueryState", () => {
  it("renders the idle slot, not the empty copy, for a disabled query", () => {
    // In v5 `isPending` is `status === "pending"`, which a disabled query stays
    // at forever. Gating the skeleton on it left these surfaces shimmering with
    // no error and no retry. The empty copy is wrong here too: "No episodic
    // memory yet." is a claim about data that was never requested.
    renderHarness(false);
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("idle")).toBeInTheDocument();
  });

  it("still renders the skeleton while the first fetch is in flight", () => {
    renderHarness(true);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("tells the operator it is offline instead of shimmering", () => {
    // Paused (offline, default `networkMode: "online"`) is the other pending
    // state that never resolves — and the one idle case with something true to
    // say, so it overrides the caller's idle slot.
    onlineManager.setOnline(false);
    renderHarness(true);
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("idle")).not.toBeInTheDocument();
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });
});
