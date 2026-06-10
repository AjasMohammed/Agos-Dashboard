import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Tests run against an already-running dev server on :5173
 * (started by the operator) with the Prism mock on :4010. Set PANEL_URL to
 * point elsewhere.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PANEL_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
