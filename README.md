# AgentOS Control Panel (`agentos-panel`)

A standalone React SPA that manages an AgentOS instance through the REST API
(`agentos-api`) only. It is contract-first: the UI is built against the vendored
OpenAPI spec and can run fully against a **mock** with zero backend.

> Plan: `obsidian-vault/plans/react-control-panel/` in the `agos` repo.
> Successor to the legacy HTMX `agentos-web` UI.

## Stack

- **Vite 6 + React 18 + TypeScript** (strict)
- **TanStack Router** (code-based route tree generated from `src/app/nav.ts`) + **TanStack Query**
- **Tailwind CSS** + hand-authored shadcn-style primitives (`src/components/ui/*`, Radix under the hood)
- **openapi-typescript** + **openapi-fetch** — typed client generated from the contract
- **Zustand** auth/theme/realtime stores · **sonner** toasts · **framer-motion**
- **Vitest** unit tests · **Playwright** e2e · **Prism** mock server

Requires **Node ≥ 20** (`.nvmrc` pins 22). The system Node is too old — run every
`npm`/`npx` command under nvm.

## Quick start

```bash
npm install
npm run generate          # contract/openapi.json -> src/api/types.gen.ts

# Dev against the mock (two terminals):
npm run mock              # Prism on :4010
npm run dev               # Vite on :5173

# Quality gates — all four must pass
npm run lint && npm run typecheck && npm run test && npm run build
npx playwright test       # e2e, against a running dev server
```

## Modes

| Mode | `VITE_API_BASE` | How |
|------|-----------------|-----|
| **Mock** (default dev) | `http://localhost:4010` | `.env.development` + `npm run mock` |
| **Integration** (real API) | `http://localhost:8080` | copy `.env.example` → `.env.local` |

> `VITE_API_BASE` is the **origin only** (no `/api/v1`) — the generated OpenAPI
> paths already include the prefix.

**CORS:** in integration mode the agos server must allow this origin. Set
`[api] cors_allowed_origins = ["http://localhost:5173"]` in the agos config.

## Keeping the contract in sync

The contract is vendored at `contract/openapi.json`. After a backend change:

```bash
# in the agos repo, regenerate first:
cargo run -p agentos-api --bin gen-openapi
cargo run -p agentos-api --bin gen-events

# then here:
AGOS_DIR=/path/to/agos npm run sync-contract   # or API_URL=http://localhost:8080
npm run generate && npm run generate:events
```

`src/api/types.gen.ts` and `src/realtime/events.gen.ts` are generated — never
edit them by hand.

## Layout

```
src/
  api/        client.ts (openapi-fetch + auth middleware + envelope unwrap),
              types.gen.ts (generated), models.ts, queries/ (one file per domain)
  auth/       store.ts (zustand + scope grants), actions.ts, login.tsx, scope-guard.tsx
  app/        router.tsx (guarded, scope-gated tree), shell.tsx, nav.ts, theme.ts
  realtime/   connection.ts (WS singleton, ticket auth, backoff/heartbeat),
              subscriptions.ts, useChannel.ts, cacheBridge.ts, protocol.ts
  features/   one folder per nav area — chat, agents, tasks, automation, govern,
              integrate, system, activity, dashboard, tools, onboarding
  components/ shared: query-state, data-table, markdown, command-palette, ui/*
  lib/        query.ts, errors.ts, confirm.tsx, use-dirty-guard.ts, format.ts, utils.ts
contract/     openapi.json + events.json (vendored, source of all generated types)
e2e/          Playwright specs
```

## Auth & scopes

`POST /auth/login` exchanges an operator credential for an API key, held in the
Zustand auth store (in memory; persisted to `sessionStorage` only when
`VITE_REFRESH_ENABLED=true`). A 401 from any call clears the store and the route
guard redirects to `/login`, preserving the current path. `can(scope)` /
`<ScopeGuard>` gate UI affordances — **the server remains the security
boundary**. Empty scopes = full access (bootstrap key).

WebSocket auth uses a single-use ticket from `/ws/ticket` so the bearer key never
appears in a URL.

## Conventions

- Route tree is generated from `NAV_ITEMS`; adding a page means adding a nav item
  **and** a `SECTION_PAGES` entry — `nav.test.ts` asserts the two stay in bijection.
- Anything that can lose unsaved work uses `useDirtyGuard` (`src/lib/use-dirty-guard.ts`).
- Query key factories must stay disjoint across domains; `keys.test.ts` enforces it.
  A key that is a prefix of another silently invalidates it — and cancels its
  in-flight refetch.
- `QueryState` distinguishes loading from *idle* (disabled or offline) — never gate
  a skeleton on `isPending`.
