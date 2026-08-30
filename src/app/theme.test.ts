import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "agentos-panel.theme";

/** The store reads storage at import time, so each case needs a fresh module. */
async function loadStore(stored: string | null) {
  localStorage.clear();
  if (stored !== null) localStorage.setItem(STORAGE_KEY, stored);
  vi.resetModules();
  return (await import("./theme")).useTheme;
}

describe("theme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
  });

  it("falls back to dark for a stored value outside the union", async () => {
    const useTheme = await loadStore("neon");
    expect(useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("falls back to dark when nothing is stored", async () => {
    const useTheme = await loadStore(null);
    expect(useTheme.getState().theme).toBe("dark");
  });

  it("keeps a valid stored value", async () => {
    const useTheme = await loadStore("light");
    expect(useTheme.getState().theme).toBe("light");
    expect(useTheme.getState().resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
