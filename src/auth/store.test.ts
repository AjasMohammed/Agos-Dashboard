import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore, grants, isAuthenticated } from "./store";

describe("grants (scope semantics)", () => {
  it("treats empty scopes as full access (bootstrap key)", () => {
    expect(grants([], "agents:r")).toBe(true);
    expect(grants([], "secrets:w")).toBe(true);
  });

  it("matches an exact resource:op scope", () => {
    expect(grants(["agents:r"], "agents:r")).toBe(true);
    expect(grants(["agents:r"], "agents:w")).toBe(false);
    expect(grants(["agents:r"], "tasks:r")).toBe(false);
  });

  it("treats rw as granting r", () => {
    expect(grants(["agents:rw"], "agents:r")).toBe(true);
    expect(grants(["agents:rw"], "agents:w")).toBe(true);
  });

  it("honors the wildcard resource", () => {
    expect(grants(["*:rw"], "anything:w")).toBe(true);
    expect(grants(["*:r"], "anything:w")).toBe(false);
  });
});

describe("auth store", () => {
  beforeEach(() => useAuthStore.getState().clear());

  it("starts unauthenticated", () => {
    expect(isAuthenticated()).toBe(false);
    expect(useAuthStore.getState().scopes).toEqual([]);
  });

  it("setSession populates and marks hydrated; can() reflects scopes", () => {
    useAuthStore.getState().setSession({
      apiKey: "agos_test",
      keyId: "k1",
      name: "ci",
      scopes: ["agents:r"],
      expiresAt: null,
    });
    const s = useAuthStore.getState();
    expect(isAuthenticated()).toBe(true);
    expect(s.hydrated).toBe(true);
    expect(s.can("agents:r")).toBe(true);
    expect(s.can("secrets:w")).toBe(false);
  });

  it("clear wipes the session", () => {
    useAuthStore.getState().setSession({ apiKey: "agos_x", scopes: ["*:rw"] });
    expect(isAuthenticated()).toBe(true);
    useAuthStore.getState().clear();
    expect(isAuthenticated()).toBe(false);
    expect(useAuthStore.getState().apiKey).toBeNull();
  });
});
