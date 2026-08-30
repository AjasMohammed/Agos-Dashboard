import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Playwright owns the dev server so the suite cannot inherit the
 * developer's `.env.development.local` (which points the panel at the real
 * kernel on :8080). That matters because every endpoint the specs assert on is
 * stubbed via `page.route`, but the shell also mounts unstubbed background
 * queries — and a single 401 from those clears the session and bounces the app
 * to /login before any assertion runs. Pointing the base at a port nothing
 * listens on makes those calls fail to connect instead, which the auth store
 * correctly treats as transient rather than as a revoked key.
 *
 * Set PANEL_URL to run against an already-running server instead (the webServer
 * block is then skipped).
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
  webServer: process.env.PANEL_URL
    ? undefined
    : {
        command: "npx vite --port 5173 --strictPort",
        url: "http://localhost:5173",
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          VITE_API_BASE: "http://127.0.0.1:4999",
          VITE_WS_BASE: "ws://127.0.0.1:4999",
          // Several specs navigate by URL (`page.goto("/files")`), which is a full
          // reload — an in-memory-only session would be lost and bounce to /login.
          VITE_REFRESH_ENABLED: "true",
        },
      },
});
