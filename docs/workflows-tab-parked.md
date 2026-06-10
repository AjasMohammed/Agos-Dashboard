# Workflows tab — parked (2026-06-10)

> The "Workflows" nav tab was removed from the panel. Pipelines is the single
> automation builder. This note explains why, what was removed vs kept, and
> exactly how to bring Workflows back when it earns its place.

## Background: workflows vs pipelines in AgentOS

Both concepts live in the kernel's `agentos-pipeline` crate and are run by **one
engine**:

- **Pipeline** (`PipelineDefinition`, YAML) — the *executable* format. A DAG of
  steps (`depends_on`), where each step is an agent task or a tool call, with
  real execution semantics: `on_failure` (fail/skip/use_default), retries with
  backoff, timeouts, `output_var` + `{{var}}` interpolation, cost/wall-time
  budgets. CRUD + **run** + import/export via `/api/v1/pipelines*`.
- **Workflow** (`WorkflowSpec`, JSON) — the *visual authoring* format: n8n-style
  typed nodes (`agent.<name>`, `tool.<name>`, structural `start`/`end`) plus a
  source→port→bucket connection map. At run time it is **compiled into a
  PipelineDefinition** (`WorkflowSpec::compile_to_pipeline()`) and executed by
  the same engine. The REST API (`/api/v1/workflows*`) exposes **CRUD only — no
  run endpoint**; running a workflow is currently possible only from the legacy
  HTMX `agentos-web` UI.

## Why the tab was removed

The panel rendered both tabs from the **same** React Flow builder
(`src/features/automation/builder/builder-page.tsx`, parameterized by
`mode: "workflow" | "pipeline"`), and the palette only offers agents + tools —
exactly the two step types a pipeline supports. So a panel workflow could not
express anything a pipeline couldn't, while being strictly weaker:

1. **Not runnable** — no run endpoint in the REST API, so the tab built
   artifacts you couldn't execute from this UI.
2. **Fewer features surfaced** — no on-failure handling, output vars,
   interpolation, or YAML import/export.
3. **Its real differentiator isn't wired up** — the kernel `NodeRegistry` is
   designed for arbitrary node types beyond `agent.*`/`tool.*`, but none exist
   in the palette (or the registry) yet.

Two near-identical drag-and-drop tabs confused users for no capability gain, so
Workflows was parked for v1.

## What was removed vs kept

Removed (UI wiring only):

- `src/app/nav.ts` — the "Workflows" nav item (and its `GitBranch` icon import).
- `src/app/router.tsx` — `/workflows` section route + `/workflows/new` and
  `/workflows/$id/edit` builder routes, and the related imports.
- `src/features/automation/automation-pages.tsx` — the `WorkflowsPage` list
  component (it contained typed `Link to="/workflows/…"` references that cannot
  compile without the routes).

Kept intact (so re-enabling is cheap):

- `src/features/automation/builder/builder-page.tsx` — the full
  `mode === "workflow"` branch and the `WorkflowBuilderPage` export.
- `src/features/automation/builder/lazy.tsx` — lazy `WorkflowBuilderPage`.
- `src/features/automation/builder/graph.ts` — `workflowToGraph` /
  `graphToWorkflow` converters (WorkflowSpec ⇄ canvas).
- `src/api/queries/automation.ts` — `useWorkflows`, `useSaveWorkflow`,
  `useDeleteWorkflow`, `fetchWorkflowDefinition` (typed against the vendored
  contract, which still includes the `/api/v1/workflows*` routes).

## When / how to bring it back

Bring the tab back only when it can do something Pipelines can't, i.e. when:

- the REST API gains a workflow **run** endpoint (compile-then-execute, like
  `agentos-web`'s `run_workflow` handler), and/or
- the kernel `NodeRegistry` grows node types beyond `agent.*`/`tool.*` worth
  exposing in the palette.

Re-enable steps (≈15 lines, reverse of the removal):

1. `nav.ts`: re-add `{ label: "Workflows", to: "/workflows", icon: GitBranch,
   scope: "workflows:r" }` under the **Automate** group.
2. `router.tsx`: import `WorkflowBuilderPage` from
   `@/features/automation/builder/lazy`, re-add the `/workflows/new` and
   `/workflows/$id/edit` builder routes, and add a `"/workflows"` entry to
   `SECTION_PAGES` pointing at a `WorkflowsPage`.
3. Recreate `WorkflowsPage` in `automation-pages.tsx` (a `DataTable` over
   `useWorkflows()` with Edit/Delete actions — mirror `PipelinesPage`; the
   removed version also showed `status`, `node_count`, and `version` columns
   via `StatusBadge`/`Badge`).
4. Give it a Run action once the API supports it — without that, don't bother.
