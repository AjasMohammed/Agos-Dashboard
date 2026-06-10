# AgentOS Control Panel (`agentos-panel`)

A standalone React SPA that manages an AgentOS instance through the REST API
(`agentos-api`) only. It is contract-first: the UI is built against the vendored
OpenAPI spec and can run fully against a **mock** with zero backend.

> Plan: `obsidian-vault/plans/react-control-panel/` (this is **Phase 09 — Foundation & App Shell**).

## Stack

- **Vite 6 + React 18 + TypeScript** (strict)
- **TanStack Router** (route tree generated from the nav config) + **TanStack Query**
- **Tailwind CSS** + shadcn-style components (Radix primitives)
- **openapi-typescript** + **openapi-fetch** — typed client generated from the contract
- **Zustand** auth/theme stores · **sonner** toasts · **Vitest** unit tests
- **Prism** mock server (`contract/openapi.json`)

Requires **Node ≥ 20** (see `.nvmrc` → 22).

## Quick start

```bash
npm install
npm run generate          # contract/openapi.json -> src/api/types.gen.ts

# Dev against the mock (two terminals, or run both):
npm run mock              # Prism on :4010
npm run dev               # Vite on :5173  (uses .env.development -> VITE_API_BASE=:4010)

# Quality gates
npm run lint && npm run typecheck && npm run test && npm run build
```

Open http://localhost:5173 → sign in → the nav shell renders with a placeholder
per feature area (real pages land in plan phases 11–15).

## Modes

| Mode | `VITE_API_BASE` | How |
|------|-----------------|-----|
| **Mock** (default dev) | `http://localhost:4010` | `.env.development` + `npm run mock` |
| **Integration** (real API) | `http://localhost:8080` | copy `.env.example` → `.env.local` |

> `VITE_API_BASE` is the **origin only** (no `/api/v1`) — the generated OpenAPI
> paths already include the `/api/v1` prefix, so the client appends the full path.

**CORS:** in integration mode the agos server must allow this origin. Set
`[api] cors_allowed_origins = ["http://localhost:5173"]` in the agos config
(see plan `01-browser-auth-and-api-keys`).

## Keeping the contract in sync

The contract is vendored at `contract/openapi.json`. Re-sync after backend changes:

```bash
# from a local agos checkout (default ../agos):
AGOS_DIR=/path/to/agos npm run sync-contract
# or from a running server:
API_URL=http://localhost:8080 npm run sync-contract
npm run generate
```

## Layout

```
src/
  api/      client.ts (openapi-fetch + auth + envelope unwrap), types.gen.ts (generated)
  auth/     store.ts (zustand + scope `grants`), actions.ts (login/hydrate), login.tsx, scope-guard.tsx
  app/      router.tsx (guarded tree from nav), shell.tsx (sidebar+topbar), nav.ts, theme.ts
  lib/      query.ts (QueryClient), errors.ts, format.ts, confirm.tsx, utils.ts (cn)
  components/ui/  button, card, sonner (shadcn-style)
  routes/   placeholder.tsx (feature stubs)
contract/   openapi.json (vendored)
```

## Auth & scopes

`POST /auth/login` exchanges an operator credential for a one-time API key,
stored in the Zustand auth store (in-memory; persisted only when
`VITE_REFRESH_ENABLED=true`). A 401 from any call clears the store and the route
guard redirects to `/login`. `can(scope)` / `<ScopeGuard>` gate UI affordances
(the server remains the security boundary). Empty scopes = full access (bootstrap key).

## Not yet wired (later phases)

- Realtime WS/SSE client + live connection status / unread badge — **Phase 10**
- Feature pages (agents, tasks, chat, schedules, governance, files, …) — **Phases 11–15**
- Playwright e2e + packaging/deploy — **Phase 16**
