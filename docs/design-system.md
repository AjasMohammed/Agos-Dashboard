# Panel design system

The control panel is an operator tool used for hours at a stretch, so the design
optimises for scanning and acting, not for a marketing screenshot. The rules below
are the ones every page follows; the primitives that encode them live in
`src/components/ui/*` and `src/components/*`.

## Principles

1. **One surface language.** The page background, one bordered surface (`Card`),
   one inset surface (`bg-surface`, for code/JSON/logs), one border colour. No
   glass, gradients, blur blobs, glows or drop shadows on content. Elevation
   (`shadow-popover`, `shadow-dialog`) is reserved for things that float.
2. **Full viewport.** Pages fill the content area (`w-full`, no max-width frame) —
   chat and artifacts included. Only short *reading* copy is measured (a page
   description gets `max-w-prose`); wide tables scroll inside their own frame.
3. **Density from typography, not chrome.** 14px body, 13px in tables/nav/forms,
   12px captions, 18px page titles, 22px stat values. Numbers are tabular
   (`.tnum`). Group labels and table headers are normal-case — no uppercase,
   letter-spaced eyebrows.
4. **Warm neutrals, one accent, one tertiary.** The neutral scale is warm —
   beige paper in light, warm charcoal in dark. Orange (`--primary`) marks
   primary actions, focus rings and the active nav item. Teal (`--tertiary`,
   orange's complement) carries reasoning traces, informational status and quiet
   highlights; `--info` is an alias of it. Status colours
   (`success`/`warning`/`destructive`/`info`) are functional only: they appear
   as 10–15% tints with text of the same hue. **The tint is the binding contrast
   case** — it darkens the ground under the text — so every status token is
   picked to clear 4.5:1 *inside its own chip*, not just on flat beige. Hue is
   never the only channel: orange/amber/red are not reliably separable under
   red-green CVD, so badges always carry their word and status icons carry an
   `aria-label`.
5. **Explain the page, not the brand.** Every page opens with `PageHeader`: a
   noun title and a one-sentence description of what the page is for and what
   the operator can do there. Empty states say what would fill them.
6. **Motion only where it carries meaning.** Menus/dialogs get a 120–140ms fade
   or zoom; live status dots pulse; page content just appears. Everything honours
   `prefers-reduced-motion`.
7. **Keyboard and screen reader first.** Every icon-only button has an
   `aria-label`; clickable rows are `role="button"` + `tabIndex=0`; folded nav
   groups expose `aria-expanded`; async notices use `role="status"`/`"alert"`.
   Targets are ≥ 28px on desktop and 32px in the sidebar.

## Tokens (`src/index.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `40 30% 94.5%` | `28 12% 8%` | page (beige / warm charcoal) |
| `card` / `popover` | `40 44% 99%` | `30 10% 11%` / `13%` | bordered surfaces, menus |
| `sidebar` | `40 26% 92%` | `28 12% 6.5%` | app chrome |
| `surface` | `40 24% 93.5%` | `30 9% 14%` | inset panels (code, JSON) |
| `muted-foreground` | `32 10% 38%` | `34 10% 64%` | secondary text (≥ 5.2:1) |
| `primary` | `22 88% 34%` | `28 92% 60%` | actions, focus, active nav |
| `tertiary` (= `info`) | `197 72% 31%` | `190 72% 60%` | reasoning steps, info status |
| `border` / `input` | `36 18% 84%` / `76%` | `30 9% 19%` / `25%` | hairlines, controls |
| `success` `warning` `destructive` | see file | see file | status only |

Radius: `--radius: 0.5rem` → `rounded-lg` 8px (cards, tables, dialogs),
`rounded-md` 6px (controls, badges), `rounded-sm` 4px.

Type scale (`tailwind.config.ts`): `xs` 12/16 · `sm` 13/20 · `base` 14/22 ·
`lg` 16/24 · `xl` 18/26 · `2xl` 22/28. Fonts: Inter Variable (UI), Fira Code
Variable (ids, code, JSON).

## Primitives

| Component | Use it for |
|---|---|
| `PageHeader` / `SectionHeader` | the title row of a page / a section within it |
| `DataTable` | any list with columns; `footer` for pagination, `maxHeight` for a sticky header |
| `Stat` + `StatGrid` | every numeric summary; `size="sm"` inside cards |
| `Callout` | every inline notice (`tone`: info/success/warning/danger/muted) |
| `EmptyState` | nothing-here surfaces; `compact` inside cards and tabs |
| `QueryState` | loading / error / empty / idle for a TanStack query |
| `SegmentedControl` | exclusive filters and view toggles (status chips, tiers) |
| `Field` | label + control + hint/error, wired for assistive tech |
| `Checkbox` | native checkbox with the brand accent |
| `DropdownMenu` | overflow/user menus (Radix) |
| `StatusBadge` / `Badge` | status words / short labels; tones map to the status hues |

Reach for these before writing a bordered `div`. When a page needs something
none of them cover, add the primitive here rather than a one-off class string.

## Layout

- Sidebar: 240px expanded / 56px rail, `bg-sidebar`, 1px right border. The
  Workspace section is always open; Automate / Govern / Integrate / System fold,
  remember their state, and open themselves when the current page is inside.
- Topbar: 48px, breadcrumb (`Group / Page`), search (⌘K), live indicator,
  notifications, theme, account menu.
- Content: `px-6 py-5`, scrolls inside `<main>`. Chat and the pipeline builder
  are full-bleed and own their scroll regions (`isFullBleed` in `shell.tsx`).

## Verifying a change

Run the screenshot sweep against the Prism mock with full-access auth stubbed
(see `e2e/panel.spec.ts` for the stub shape), in dark and light and at 390px,
before calling a visual change done. The e2e suite (`e2e/panel.spec.ts`) pins the
nav structure, login copy and the dashboard/tasks/agents/files landmarks.
