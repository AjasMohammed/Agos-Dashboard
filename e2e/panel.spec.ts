import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke E2E against the running dev server (:5173) + Prism mock (:4010).
 * Covers the Phase 09/10 substrate: auth guard, login → shell, nav routing,
 * theme toggle, and the realtime connection indicator.
 *
 * The login helper stubs the auth endpoints with a realistic *full-access*
 * session (`scopes: ["*:rw"]`) so the whole scope-gated nav renders. (The Prism
 * mock returns placeholder `scopes: ["string"]`, which — correctly — grants
 * nothing, so only the un-scoped Dashboard link would show.)
 */

const FULL_ACCESS = {
  api_key: "agos_e2e",
  key_id: "k1",
  name: "operator",
  scopes: ["*:rw"],
  expires_at: null,
};

const DASHBOARD = {
  agent_count: 2,
  background_task_count: 1,
  online_agents: [
    {
      id: "a1",
      name: "alpha",
      provider: "anthropic",
      model: "claude-opus-4-8",
      status: "online",
      roles: [],
      connected_at: "2026-06-01T00:00:00Z",
    },
  ],
  recent_audit: [
    { event_type: "TaskCompleted", details: "summarized logs", timestamp: "2026-06-01T00:00:00Z" },
  ],
  task_counts: { total: 10, running: 2, completed: 7, failed: 1 },
  tool_count: 15,
  uptime_secs: 3723,
};

async function stubAuth(page: Page) {
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: FULL_ACCESS }) }),
  );
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { ...FULL_ACCESS, api_key: undefined } }),
    }),
  );
  await page.route("**/api/v1/dashboard", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: DASHBOARD }) }),
  );
}

async function login(page: Page) {
  await stubAuth(page);
  await page.goto("/login");
  await page.getByLabel(/operator credential/i).fill("test-operator-token");
  await page.getByRole("button", { name: /sign in/i }).click();
  // Landed on the authenticated shell — the Dashboard page header renders.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("unauthenticated visit redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/AgentOS Control Panel/i).first()).toBeVisible();
  await expect(page.getByLabel(/operator credential/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("login lands on the shell with grouped navigation", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/$/);
  // Sidebar groups + a few representative nav links (visible with full access).
  await expect(page.getByText("Operate")).toBeVisible();
  await expect(page.getByText("System")).toBeVisible();
  await expect(page.getByRole("link", { name: "Agents" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tasks" })).toBeVisible();
});

test("dashboard renders live stat cards (not a placeholder)", async ({ page }) => {
  await login(page);
  // Scope to the main content — nav links share names with the stat cards.
  const main = page.getByRole("main");
  await expect(main.getByText("Uptime")).toBeVisible();
  await expect(main.getByText("1h 2m")).toBeVisible(); // 3723s
  await expect(main.getByText("Tools")).toBeVisible();
  await expect(main.getByText("Task status")).toBeVisible();
  await expect(main.getByText("Recent activity")).toBeVisible();
});

test("navigating to feature pages renders real pages", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Tasks" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: /new task/i })).toBeVisible();

  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect agent/i })).toBeVisible();
});

test("theme toggle flips the root color scheme", async ({ page }) => {
  await login(page);
  const html = page.locator("html");
  const before = (await html.getAttribute("class")) ?? "";
  await page.getByRole("button", { name: /Theme:/i }).click();
  await expect(html).not.toHaveClass(before);
});

test("topbar shows a realtime connection indicator", async ({ page }) => {
  await login(page);
  // No WS server behind the mock, so the indicator is Offline/Connecting/Reconnecting.
  await expect(page.getByText(/Live|Offline|Connecting|Reconnecting/i).first()).toBeVisible();
});

test("scope gating hides nav items the key cannot access", async ({ page }) => {
  // A read-only audit key should see Audit but not Agents/Secrets.
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { ...FULL_ACCESS, scopes: ["audit:r"] } }),
    }),
  );
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { ...FULL_ACCESS, api_key: undefined, scopes: ["audit:r"] } }),
    }),
  );
  await page.goto("/login");
  await page.getByLabel(/operator credential/i).fill("audit-key");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Agents" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Secrets" })).toHaveCount(0);
});

const FILES = {
  data: [
    {
      id: "f1f2f3f4-0000-0000-0000-000000000001",
      name: "report.pdf",
      original_name: "Q2 Report.pdf",
      mime: "application/pdf",
      size: 2048,
      scope: "global",
      tags: [],
      uploaded_at: "2026-06-01T00:00:00Z",
    },
    {
      id: "f1f2f3f4-0000-0000-0000-000000000002",
      name: "notes.md",
      original_name: "notes.md",
      mime: "text/markdown",
      size: 512,
      scope: "global",
      tags: [],
      uploaded_at: "2026-06-02T00:00:00Z",
    },
  ],
  meta: { total: 2 },
};

async function stubFiles(page: Page) {
  await page.route("**/api/v1/files", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FILES) }),
  );
}

test("files page shows the file ID and a copy-mention action", async ({ page }) => {
  await login(page);
  await stubFiles(page);
  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "File ID" })).toBeVisible();
  // Truncated id rendered as a click-to-copy button carrying the full id in its title.
  await expect(page.getByTitle(/f1f2f3f4-0000-0000-0000-000000000001 — click to copy/)).toBeVisible();
  await expect(page.getByRole("button", { name: /mention/i })).toHaveCount(2);
});

test("typing @ in the run-task prompt suggests uploaded files", async ({ page }) => {
  await login(page);
  await stubFiles(page);
  await page.route("**/api/v1/tasks*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    }),
  );
  await page.route("**/api/v1/agents*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    }),
  );
  await page.goto("/tasks");
  await page.getByRole("button", { name: /new task/i }).click();

  const prompt = page.getByPlaceholder(/Summarize the latest audit events/);
  await prompt.fill("Summarize @rep");
  // Suggestion list opens, filtered to the matching file.
  await expect(page.getByRole("option", { name: /report\.pdf/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /notes\.md/ })).toHaveCount(0);
  // Enter picks the highlighted file and inserts the sanitized @name.
  await prompt.press("Enter");
  await expect(prompt).toHaveValue("Summarize @report.pdf ");

  // Escape with the menu open closes only the menu — the dialog (and the
  // typed prompt) survive; a second Escape then closes the dialog.
  await prompt.pressSequentially("@");
  await expect(page.getByRole("listbox", { name: /uploaded files/i })).toBeVisible();
  await prompt.press("Escape");
  await expect(page.getByRole("listbox", { name: /uploaded files/i })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(prompt).toHaveValue("Summarize @report.pdf @");
  await prompt.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
