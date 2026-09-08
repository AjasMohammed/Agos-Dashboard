# AgentOS Control Panel — CLAUDE.md

A standalone **React + TypeScript** single-page app that manages an AgentOS instance
through its REST API (`agentos-api`) only. It is the successor to the legacy HTMX
`agentos-web` UI. This project was extracted from the `agos` monorepo and is now
developed independently here on the Desktop (sibling folder to `../agos`).

---

## ⚠️ Toolchain — use Node 20+ via nvm (NOT the system Node)

The system Node is **v12** — far too old for Vite 6 / TanStack / openapi-typescript.
**Every** `npm`/`node`/`npx` command in this project must run under nvm Node 22:

```bash
export PATH="/home/ajas/.nvm/versions/node/v22.22.2/bin:$PATH"   # then npm/npx/node…
```

(v20.20.2 also works.) If a build/test/lint command fails with engine or syntax
errors, this is almost always the cause — re-export the PATH.

---

## Stack

- **Vite 6 + React 18 + TypeScript** (strict)
- **TanStack Router** (code-based route tree generated from `src/app/nav.ts`) + **TanStack Query**
- **Tailwind CSS** + hand-authored shadcn-style primitives (`src/components/ui/*`, Radix under the hood)
- **Design system:** [`docs/design-system.md`](docs/design-system.md) — tokens, type scale, the
  primitive to reach for, and the layout rules. Read it before any visual work.
- **openapi-typescript** + **openapi-fetch** — typed client generated from the vendored contract
- **Zustand** auth/theme/realtime-status stores · **sonner** toasts
- **Vitest** unit tests · **Playwright** e2e · **Prism** mock server (`contract/openapi.json`)

## Commands

```bash
npm install
npm run generate     # contract/openapi.json -> src/api/types.gen.ts (run after a contract sync)
npm run dev          # Vite dev server on :5173
npm run mock         # Prism mock API on :4010
npm run lint         # eslint --max-warnings 0
npm run typecheck    # tsc --noEmit
npm run test         # vitest (unit; scoped to src/, excludes e2e/)
npm run build        # tsc --noEmit && vite build
npx playwright test  # e2e against a running dev server + (mock or real) API
```

## Quality gate (run before declaring work done)

`tsc --noEmit` · `eslint --max-warnings 0` · `vitest run` · `vite build` must all pass.
For UI behavior changes, also run the Playwright e2e (`e2e/panel.spec.ts`) against a
running app. **Use the code-review skill (`.claude/skills/review`) after non-trivial
changes**, and `ui-ux-pro-max` for visual/UX work.

## Layout

```
src/
  api/
    client.ts        openapi-fetch client + unwrap()/unwrapList() + ApiError + auth middleware
    types.gen.ts     GENERATED from the contract — never edit by hand
    models.ts        DTO type aliases (components["schemas"][...])
    queries/         one file per domain: dashboard, agents, tasks, tools, chat,
                     governance, extensibility, automation, system
  features/          one folder/file per nav area; pages + dialogs (the UI)
  app/               router.tsx (guarded, scope-gated route tree), shell.tsx, nav.ts, theme.ts
  auth/              store.ts (zustand + grants()/can()), actions.ts (login/hydrate), login.tsx, scope-guard.tsx
  realtime/          connection.ts (WS singleton + ticket auth + backoff/heartbeat),
                     subscriptions.ts, useChannel, cacheBridge, protocol.ts
  components/        shared: data-table, query-state, empty-state, page-header, status-badge, ui/*
  lib/               query.ts (QueryClient), errors.ts, confirm.tsx, use-dirty-guard.ts,
                     format.ts, utils.ts (cn)
contract/openapi.json  vendored API contract (source of all generated types)
```

## Parked: the Workflows tab (read before touching automation)

There is intentionally **no "Workflows" nav tab** — only Pipelines. Kernel
workflows (`WorkflowSpec`) compile into pipelines and run on the same engine,
the REST API has no workflow-run endpoint, and the panel's palette (agents +
tools) can't express anything a pipeline can't — so the tab was redundant and
weaker. As of 2026-08-29 the machinery is **deleted, not just unrouted**: the
`mode="workflow"` branches, `WorkflowBuilderPage`, `graphToWorkflow`/`workflowToGraph`
and the four workflow query hooks are gone (~250 lines; recover from git at
`883b725` if ever needed). The backend routes still exist. **Do not re-add the tab without reading
[`docs/workflows-tab-parked.md`](docs/workflows-tab-parked.md)** (full
rationale + exact re-enable steps).

## UI conventions (read before editing a page)

- **Use the primitives, not class strings.** `PageHeader`, `DataTable`, `Stat`/`StatGrid`,
  `Callout`, `EmptyState`, `SegmentedControl`, `Field`, `Checkbox`, `DropdownMenu`, `Card`.
  A bordered `div` with its own radius/tint is a regression — extend a primitive instead.
- **No decoration.** No gradients, glass/blur, glows, `rounded-2xl`, uppercase letter-spaced
  eyebrows, entrance animations on content, or `max-w-*` frames around a page. Elevation is
  only for popovers/dialogs (`shadow-popover`/`shadow-dialog`).
- **Tokens only.** Colours come from `src/index.css` (`bg-card`, `bg-surface`, `text-muted-
  foreground`, status hues). Never hardcode a Tailwind palette colour (`emerald-500`, `amber-…`).
- **Type scale is global.** `text-sm` is 13px, `text-base` 14px (see `tailwind.config.ts`);
  page titles are `text-xl`, stat values `text-2xl`, numbers get `.tnum`.
- **Nav is data.** Labels/groups/scopes live in `src/app/nav.ts`; the sidebar, breadcrumb,
  command palette and route tree all derive from it. The e2e spec pins its shape.

## Conventions & gotchas (read before editing the API layer)

- **`VITE_API_BASE` is the ORIGIN only** (e.g. `http://localhost:8080`) — the OpenAPI
  paths already carry the `/api/v1` prefix, so the base must NOT include it. Double-
  prefixing → 404 on every call.
- **Vite env precedence:** `.env.development.local` **>** `.env.development`. The mock
  default lives in `.env.development` (origin `:4010`); the integration override
  (real API, origin `:8080`) lives in **`.env.development.local`** (gitignored). A plain
  `.env.local` is ignored in dev mode — don't use it.
- **Response shapes:** success is `{ data: T }` (`unwrap`), lists are `{ data: T[], meta:{total} }`
  (`unwrapList`). The live API wraps errors as `{ error: { code, message, status } }`; the vendored
  contract documents the flat `{ code, message, status }` — `client.ts` accepts both → `ApiError`.
- **Auth:** the login screen takes the **operator credential** (the `[api] operator_token`
  configured on the kernel), which `POST /auth/login` exchanges for a scoped `agos_…` key
  stored in the Zustand auth store (in-memory; persisted to localStorage only when
  `VITE_REFRESH_ENABLED=true`). The key is sent as `Authorization: Bearer` by the client
  middleware and by the raw `fetch` helpers (chat stream/export, file upload). 401 →
  store cleared → redirect to `/login`.
- **Scope-gating:** nav items declare a `scope` in `nav.ts`; the sidebar hides un-granted
  items AND `router.tsx` enforces it in `beforeLoad` via `scopeGuard(scope)` (so a section
  can't be reached by typing the URL). `grants()`/`can()` mirror the backend
  `require_permission` (empty scopes = **no** access — fail closed; `*` wildcard; `rw ⊇ r`).
- **Mutations:** every `mutateAsync` handles its own error (`.catch(toastError)` or
  try/catch). There is intentionally **no** global mutation `onError` in `query.ts` —
  a global one would double-toast.
- **Request plumbing (`client.ts`):** every typed call gets a 30s deadline merged with the
  caller's signal — pass TanStack's `signal` from `queryFn` into `client.GET(..., { signal })`
  for search-as-you-type queries so superseded requests are cancelled. `unwrap` treats 204
  as success and throws `SHAPE` on a missing envelope; a 2xx that isn't JSON is recast as a
  502 `BAD_GATEWAY`. `ApiError.retryAfterMs` (from `Retry-After`) drives 429 retries.
  `errorMessage()` turns `Failed to fetch` / `TimeoutError` into actionable sentences.
- **Chat stream:** a turn is an ordered list of `StreamPart`s (`text` | `thinking` | `tool`)
  built in arrival order — never regroup them (tools-then-text was the bug). The kernel's
  `thinking` frame opens a pass as a bare marker (`{iteration}`) and then streams the model's
  reasoning as `{iteration, text}` deltas; a pass with no text stays a labelled step and
  nothing is invented to fill it. Reasoning rides the SAME rAF buffer as `chunk` text (two
  buffers would let a frame of one overtake the other) and never joins `streamText()` — it is
  the scratchpad, not the reply. `ApiChatMessage` has no field for it, so the
  handover would drop it — `turnThinking` keeps the newest turn's reasoning past
  the refetch (same trick as `turnUsage`), collapsed above the reply. It is still
  memory-only: a reload, or an older turn, has none. A stream that ends without a `done` frame is an error
  (truncated reply); a `done` with no chunks falls back to its `answer` (gateway turns);
  tokens/cost from `done` live in `turnUsage` because `ApiChatMessage` carries neither. A
  failure KEEPS the partial turn on screen with an error card (message + status/code detail +
  protocol warnings + Copy details) — never delete the evidence and leave only a toast. The
  composer is free once a turn is `done`, and parked text after a failure is only restored if
  the kernel did not already persist that user turn (so there is deliberately no Retry button).
- **Realtime:** the WS connection (`connection.ts`) is a module singleton driven by the
  auth store (connect on key, drop on logout) with backoff + heartbeat. Chat streaming
  uses the SSE endpoint via `streamChatMessage` (`api/queries/chat.ts`) driven by the
  module-scoped store in `features/chat/stream-store.ts`. The unused WS chat hooks
  (`useChatStream`, `useEventSource`) were deleted 2026-08-29 — bring them back from git
  history if the WS chat path is ever wired.
- **Query keys must stay disjoint across domains.** A key that is a prefix of another
  silently invalidates it *and cancels its in-flight refetch* (`invalidateQueries` defaults
  to `cancelRefetch: true`). `src/api/queries/keys.test.ts` enforces this.
- **Never gate a skeleton on `isPending`.** In React Query v5 that is true for a disabled
  query and for a paused (offline) one — both would spin forever. `QueryState` has a
  separate `idle` phase; use `isLoading` for a genuine in-flight fetch.
- **Anything that can lose unsaved work uses `useDirtyGuard`** (`src/lib/use-dirty-guard.ts`),
  which covers in-app navigation, reload/close, and — via `confirmDiscard()` — dialog
  closes and in-place document switches.

## Adding a feature page

1. Add query/mutation hooks in `src/api/queries/<domain>.ts` (use `client` + `unwrap`/`unwrapList`;
   invalidate the right keys).
2. Build the page in `src/features/<area>/…` using `PageHeader` + `QueryState` + `DataTable`/cards.
3. Wire the route in `src/app/router.tsx` and (if it's a new nav entry) `src/app/nav.ts` with its
   `scope`. Section routes are generated from `NAV_ITEMS` and auto-scope-gated.

## Keeping the contract in sync

The contract is vendored at `contract/openapi.json`. After backend changes in `../agos`:

```bash
npm run sync-contract        # defaults to ../agos (the sibling monorepo); or API_URL=… to curl a server
npm run generate             # regenerate src/api/types.gen.ts
npm run generate:config-hints # ../agos config/default.toml comments -> Config page hints
npx tsc --noEmit             # catch any drift the new types introduce
```

The Config page's per-key descriptions come from the kernel's annotated
`config/default.toml` (the REST API serves values with no docs), vendored into
`src/features/system/config-hints.gen.ts` — regenerate after a kernel config change.

## Skills available here (`.claude/skills/`)

- **ui-ux-pro-max** — UI/UX design intelligence (React, shadcn/ui, Tailwind). Use for any
  visual/layout/component work.
- **review** — code review skill. Use after non-trivial changes.
- **previewer** — reads PR review comments and applies fixes.

## House rules

- **Never auto-commit** — only commit when explicitly asked.
- Don't edit `src/api/types.gen.ts` by hand (regenerate it).
- Keep components matching the surrounding style (Tailwind utility classes, the existing
  shadcn-style primitives, `cn()` for class merging).
