# HYR-7: Body Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** A front/back SVG body map with 9 zones (13 hit-regions), keyboard and screen-reader operable, exposing `selected` and `onselect` for HYR-27.

**Spec:** `docs/specs/2026-10-08-body-map-design.md` (read sections 3, 5 and 9 first).

**Status:** All spec decisions (D1-D10) RESOLVED; ready to build. Stack: SvelteKit + Tailwind + Vitest, basic placeholder SVG (no real art), `ASS` label "Glutes", side-by-side views, `shared/` + `web/` workspaces beside the root backend.

## Global constraints

- Exact-pinned dependencies: install, then strip `^`/`~`, matching `package-lock.json`. Root `package.json` change is only the `workspaces` field.
- Style (CLAUDE.md): explicit return types, no single-letter names (except `i/j/k` in indexed loops), no inline `if`, blank line before `if/for/while/return/throw`, no `!!x`, no nested function declarations, numeric separators on 5+ digit literals, no barrel files, comments only for a non-obvious why, constructor/DI readonly where applicable.
- Tests: nested `describe` per condition (`when ...`), short `it` titles, shared setup in that `describe`'s `beforeEach`.
- Git: stage each task's files with `git add`, do NOT commit; user reviews with `/crit`. Conventional Commits for any later commit. Branch currently `maseru/hyr-7-handle`; rename to `hyr-07` before pushing or opening a PR, never after. Move Linear HYR-7 to In Progress at build start (check current state first), In Review only when staged.
- Gate per task touching code: root `npm run lint`, `npm run lint:arch`, `npm test`, `npm run build` still pass (backend unaffected), plus workspace tests and `web` type-check/build.
- Do not touch `src/` except the single contract spec in Task 1.5.

## Task dependencies

Phase 0 -> Phase 1 -> (Phase 2 and Phase 3 skeleton in parallel) -> Phase 3 completion -> Phase 4 -> Phase 5.
Everything is frontend/shared work. The only backend-side file is a test (Task 1.5), which depends on Task 1.1.

## Phase 0: Workspaces and web scaffold

### Task 0.1: Add workspaces
Files: modify `package.json` (root), create `shared/package.json`, `shared/tsconfig.json`, `web/package.json`.
- [ ] Add `"workspaces": ["shared", "web"]` to root `package.json`. Confirm `npm ci` at root still resolves and root `npm test` / `npm run build` still pass unchanged (the backend `tsconfig` and vitest config must not pick up `web/` or `shared/`; adjust `include`/`exclude` if they do).
- [ ] `shared` package: name `@hyrox-sponsor/shared`, ESM, TS, own Vitest. Consumers import from specific files, no barrel.
- [ ] Confirm `.dependency-cruiser.cjs` scope (`src` only) does not break.

### Task 0.2: Scaffold `web`
Files: `web/` SvelteKit app (TypeScript), Tailwind, Vitest + Testing Library + jsdom config.
- [ ] Scaffold minimal app with a single route `web/src/routes/dev/body-map/+page.svelte` as a dev harness (also used for manual QA and to show HYR-27 how to consume).
- [ ] Per user convention, third-party CSS imports (none expected here) go through JS, not CSS `@import`.
- [ ] Verify `npm run -w web check`, `-w web test`, `-w web build` succeed on the empty scaffold.
- [ ] Add `web` and `shared` scripts to root only if needed; keep root scripts for the backend as they are.

## Phase 1: Shared zone model

### Task 1.1: Zone list and labels
Files: `shared/src/body-zone.ts`, `shared/src/body-zone-labels.ts`, matching `*.spec.ts`.
- [ ] Failing tests: exactly 9 zones; values equal the names in spec section 1; labels exist for every zone; no duplicate labels.
- [ ] Implement `BODY_ZONES` (readonly tuple), `BodyZone` type, `BODY_ZONE_LABELS` record typed so a missing zone fails to compile. Label for `ASS` is "Glutes".

### Task 1.2: View and region model
Files: `shared/src/body-map-geometry.ts` (types + data), `shared/src/body-map-geometry.spec.ts`.
- [ ] Failing tests (spec section 7 list): 13 regions total; counts per view (front 6, back 7); region ids unique; every zone has at least one region; pecs only front; upper/lower back and ASS only back; arms and thighs on both; anatomical mapping (front view: `LEFT_*` regions have larger x-centre than `RIGHT_*` regions, back view: the reverse); every `pathData` non-empty and parses as SVG path commands (simple regex check).
- [ ] Define types `BodyMapView`, `BodyMapRegion { zone, id, pathData }`, and export `BODY_MAP_VIEWS`. Initially use rough rectangle placeholder paths so tests pass; art arrives in Phase 2.
- [ ] A helper `regionsForZone(zone)` returning all regions of a zone (used by the component to highlight both arm/thigh regions). Test it.

### Task 1.5: Backend contract test
Files: create `src/common/body-zone-contract.spec.ts`.
- [ ] Failing-first test: `BODY_ZONES` from the shared package equals `Object.keys(BodyZone)` from `@prisma/client`. Needs backend resolution of the workspace package (type-only dev link); if this complicates the root TS config, fall back to a test in `shared` that reads `prisma/schema.prisma` and parses the enum block. Decide at implementation and note it.
- [ ] Root gate passes.

## Phase 2: Illustration

### Task 2.1: Silhouette and region paths
Files: modify `shared/src/body-map-geometry.ts` only.
- [ ] Replace placeholder paths with a clean neutral silhouette per view (shared viewBox size, e.g. 200 x 480 each) plus region paths that tile the torso/limbs without overlap and with a small gap.
- [ ] Add a geometry test that regions do not overlap (sample a grid of points and assert at most one region contains each point; use a small path-in-polygon helper only if paths are polygon-simple, otherwise do this check manually in QA and say so).
- [ ] Basic hand-authored placeholder only; no real art (D2).

## Phase 3: Component

### Task 3.1: Pure interaction logic
Files: `web/src/lib/body-map/body-map-state.ts` + spec (framework-free helpers: next selection, whether a zone is interactive given `disabled` and `zoneStates`, accessible label builder).
- [ ] Failing tests grouped by condition: when whole map disabled, when zone disabled, when re-selecting the selected zone (stays selected, D6), label includes badge when present.
- [ ] Implement.

### Task 3.2: `BodyMap.svelte`
Files: `web/src/lib/body-map/BodyMap.svelte`, `BodyMap.spec.ts`.
- [ ] Failing component tests (spec section 7): each of 13 regions emits correct zone; clicking an arm region on either view marks both regions pressed; Enter and Space emit; disabled zone and whole-map disabled emit nothing; `aria-pressed` reflects `selected`; accessible names include zone label and view; left/right anatomical.
- [ ] Add tests: hovering/focusing an arm or thigh region highlights both regions; arm/thigh regions carry captions like "Left arm (front + back)"; a single shared selected-zone chip under the map shows the selected zone label (empty when none).
- [ ] Implement per spec 5.3 and 5.4: props `selected` (bindable), `zoneStates`, `disabled`; callback prop `onselect`. Render both views side by side, stacking below a Tailwind breakpoint.
- [ ] Styling: selected = fill + stroke change, hover lighter fill, focus ring visible, colors AA against silhouette (check with a contrast calc, record ratios in the PR description).

## Phase 4: Accessibility and touch hardening

### Task 4.1: A11y pass
- [ ] Add visually-hidden polite live region announcing the selected zone; test its text.
- [ ] Verify tab order front then back; add a test asserting the DOM order of focusable regions.
- [ ] Add wider transparent stroke touch targets to thin regions (arms); manual check at 375 px width.
- [ ] Respect `prefers-reduced-motion`.
- [ ] Run an automated a11y check (e.g. axe via a Vitest plugin) if it adds no heavy dependency; otherwise record manual checklist results.

## Phase 5: Harness and hand-off

### Task 5.1: Dev harness and docs
- [ ] Wire the dev route to show the map, current selection, and a stubbed `zoneStates` badge example, demonstrating how HYR-27 mounts it with a price input beside it.
- [ ] README section: workspace layout, how to run `web`, the component API (props/events), and that final art can be replaced by editing paths in `shared/src/body-map-geometry.ts`.
- [ ] Final gate: root and workspace lint/test/build; manual browser check at 375, 768, 1280 px by qa-verifier (outside this plan).

## Out of scope (follow-ups)

Price input and $10 minimum (HYR-27), deploy adapter and hosting (D7), automated visual regression, bidder-facing read-only variant, restructuring the backend into `api/` (D8).
