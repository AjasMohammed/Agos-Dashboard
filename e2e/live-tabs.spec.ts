import { test, expect, type Page, type Response } from "@playwright/test";
import { NAV_ITEMS } from "../src/app/nav";

/**
 * Live smoke against a **running kernel** — nothing is stubbed. It walks every
 * sidebar route plus /artifacts and fails on any 4xx/5xx from the API or any
 * error boundary, which is what a hand walk-through of the tabs would catch.
 *
 * Opt-in: it only runs when both are set, because it needs a real operator
 * token and a panel pointed at the real API.
 *
 *   PANEL_URL=http://localhost:5173 \
 *   AGENTOS_OPERATOR_TOKEN=… \
 *   npx playwright test e2e/live-tabs.spec.ts
 */
const TOKEN = process.env.AGENTOS_OPERATOR_TOKEN;

test.describe("live tabs", () => {
  test.skip(
    !TOKEN || !process.env.PANEL_URL,
    "set AGENTOS_OPERATOR_TOKEN and PANEL_URL to run against a live kernel",
  );
  test.describe.configure({ mode: "serial" });

  /**
   * Failures the panel renders correctly and that do not indicate a broken tab:
   * the marketplace proxies an external registry that is usually not running.
   */
  const TOLERATED = [/\/api\/v1\/marketplace/];

  function watchApi(page: Page, bad: string[]) {
    page.on("response", (res: Response) => {
      const url = res.url();
      if (!url.includes("/api/v1/")) return;
      if (res.status() < 400) return;
      if (TOLERATED.some((re) => re.test(url))) return;
      bad.push(`${res.status()} ${res.request().method()} ${new URL(url).pathname}`);
    });
  }

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel(/access key/i).fill(TOKEN!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible({ timeout: 15_000 });
  }

  const routes = [...NAV_ITEMS.map((i) => i.to), "/artifacts"];

  test("every tab loads against the real kernel with no API errors", async ({ page }) => {
    // One reload per route, paced, against a real kernel — the 30s default is
    // for a single interaction, not a walk of the whole sidebar.
    test.setTimeout(30_000 + routes.length * 8_000);
    const bad: string[] = [];
    watchApi(page, bad);
    await login(page);

    const broken: string[] = [];
    for (const to of routes) {
      await page.goto(to);
      // Pace the walk: the API's per-IP governor is sized for a human clicking
      // through tabs, and a zero-delay sweep of 30 routes is not that. Without
      // this the run reports 429s that a real operator never sees.
      await page.waitForTimeout(250);
      // The error boundary replaces the whole page, so its copy is the signal.
      const boundary = page.getByText(/something went wrong/i);
      if (await boundary.isVisible().catch(() => false)) broken.push(`${to}: error boundary`);
      // Let the route's queries settle before moving on. Bounded: the panel
      // holds a realtime WS open, so "networkidle" is never reached on some
      // routes and an unbounded wait would spend the whole test budget here.
      await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
    }

    expect(broken, "routes that crashed").toEqual([]);
    expect([...new Set(bad)], "API responses ≥400").toEqual([]);
  });

  test("integrate tabs expose their add actions", async ({ page }) => {
    await login(page);
    for (const [to, action] of [
      ["/mcp", "Attach server"],
      ["/channels", "Connect channel"],
      ["/plugins", "Add plugin"],
      ["/connectors", "Add connector"],
    ] as const) {
      await page.goto(to);
      await expect(
        page.getByRole("button", { name: action }).first(),
        `${to} must offer "${action}"`,
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  // The catalog is the one new GET the route walk cannot reach: it fires only
  // when the dialog opens. Read-only — nothing is installed.
  test("the MCP catalog loads", async ({ page }) => {
    const bad: string[] = [];
    watchApi(page, bad);
    await login(page);
    await page.goto("/mcp");
    await page.getByRole("button", { name: "Browse catalog" }).click();
    await expect(page.getByRole("heading", { name: /tool server catalog/i })).toBeVisible();
    // Either rows or the empty state — both mean the fetch resolved.
    await expect(
      page.getByRole("button", { name: /^Install/ }).first().or(page.getByText(/no matching servers/i)),
    ).toBeVisible({ timeout: 10_000 });
    expect(bad, "API responses ≥400").toEqual([]);
  });

  test("notifications can be cleared in one click", async ({ page }) => {
    await login(page);
    await page.goto("/notifications");
    await expect(page.getByRole("button", { name: /clear all/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /mark all read/i })).toBeVisible();
  });
});
