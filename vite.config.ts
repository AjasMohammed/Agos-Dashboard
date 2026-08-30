import { defineConfig, type Plugin } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const CSP_PLACEHOLDER = "%CSP_POLICY%";

/**
 * Fill `%CSP_POLICY%` in index.html from the API/WS bases this build actually
 * targets. Hardcoding the origins in the HTML meant the policy was only correct
 * on the two localhost ports it happened to list — any other deployment (and any
 * e2e run pointed elsewhere) had its own API calls blocked by its own CSP, with
 * the failure surfacing as an unexplained network error.
 *
 * `script-src` keeps 'unsafe-inline' because Vite's dev refresh preamble and the
 * pre-paint theme script are inline; a nonce is the correct fix once a real
 * server renders this page.
 */
function cspPlugin(mode: string): Plugin {
  // Read the env from the directory holding *this config*, not `process.cwd()`:
  // invoked from a parent dir (`vite --config agentos-panel/vite.config.ts`, a
  // monorepo task runner) cwd points elsewhere, `loadEnv` finds no .env, and the
  // policy silently narrows to `connect-src 'self'` — blocking the panel's own
  // API calls, i.e. exactly the unexplained network error described above.
  // Hoisted out of the hook too: this is constant per config load, and the hook
  // runs on every dev-server request for index.html.
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_");
  const origins = new Set<string>();
  for (const base of [env.VITE_API_BASE, env.VITE_WS_BASE]) {
    if (!base) continue;
    try {
      origins.add(new URL(base).origin);
    } catch {
      // A malformed base is the operator's problem, not a reason to emit a
      // broken policy — skip it and let the request fail visibly instead.
    }
  }
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    `connect-src ${["'self'", ...origins].join(" ")}`,
  ].join("; ");

  return {
    name: "agentos-csp",
    transformIndexHtml(html) {
      if (!html.includes(CSP_PLACEHOLDER)) {
        // Fail loudly rather than ship `content="%CSP_POLICY%"`: a browser reads
        // that as a single unknown directive and drops the whole policy with no
        // console error, so the panel would run with no CSP and no symptom.
        throw new Error(
          `index.html is missing the ${CSP_PLACEHOLDER} placeholder — the CSP meta tag would ship unfilled and be ignored by browsers.`,
        );
      }
      return html.replace(CSP_PLACEHOLDER, policy);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), cspPlugin(mode)],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Unit tests live under src/; e2e/ is Playwright-only (different runner).
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
}));
