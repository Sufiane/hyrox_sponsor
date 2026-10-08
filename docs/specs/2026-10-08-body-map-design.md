# HYR-7: Body Map Illustration with 9 Clickable Zone Hit-Regions - Design

Status: APPROVED, all decisions resolved (section 9). Linear HYR-7 has no description; this spec is inferred from the title, the core data model spec, and the repo. Blocks HYR-27 (per-zone floor price input, $10 platform minimum).

## 1. Context and findings

- The repo is backend-only (NestJS 12, Prisma, Vitest). There is no `web/`, `shared/` or any frontend project. The core data model spec (section 3) says "no npm workspaces yet (no shared package to split out until a frontend project exists)". HYR-7 is therefore the first frontend ticket, and it forces a frontend stack decision nobody has recorded.
- The nine zones already exist as the Prisma enum `BodyZone` (`prisma/schema.prisma`): `LEFT_PEC, RIGHT_PEC, UPPER_BACK, LOWER_BACK, LEFT_ARM, RIGHT_ARM, LEFT_THIGH, RIGHT_THIGH, ASS`. They are persisted in `ZoneFloorPrice.zone` and `Auction.zone`. The product spec calls them "9 fixed" zones.
- No backend endpoint or code references `BodyZone` yet (zone floor price service is HYR-27's concern). HYR-7 needs no backend change.
- The user's global convention for frontends: SvelteKit + Tailwind elsewhere, npm workspaces with a `shared/` package for shared TS types, exact-pinned dependencies, explicit return types, no single-letter names, no barrel files, Vitest-style nested `describe` per condition.

## 2. Goal and non-goals

Goal: a reusable, accessible body-map component showing a front and a back silhouette, where each of the 9 zones is a clickable, keyboard-operable hit-region that reports which `BodyZone` was chosen. HYR-27 mounts it and renders the floor price input for the chosen zone.

Non-goals: price input, the $10 minimum, any API call, auth, persistence, bidder/auction views, final art direction beyond a clean placeholder-quality silhouette.

## 3. Zone-to-view geometry (assumption A1)

Anatomical naming: `LEFT_*` means the athlete's own left, so on the front view it appears on the viewer's right (and on the back view on the viewer's left). This is a trap worth a test and a visible label.

| Zone | Front view | Back view |
|---|---|---|
| LEFT_PEC, RIGHT_PEC | yes | no |
| UPPER_BACK, LOWER_BACK | no | yes |
| LEFT_ARM, RIGHT_ARM | yes | yes (same zone, second region) |
| LEFT_THIGH, RIGHT_THIGH | yes | yes (same zone, second region) |
| ASS | no | yes |

So 9 zones produce 13 hit-regions (2 pecs, 2 arms, 2 thighs on front = 6; upper back, lower back, 2 arms, 2 thighs, ass on back = 7). Selecting a region of an arm or thigh on either view selects the same zone, and both regions highlight together on hover and selection. Rationale: a zone is the sellable ad space, not a surface patch; one price per zone.

## 4. Approaches considered

Illustration source:
1. Hand-authored inline SVG, one `<path>` per hit-region, silhouette paths behind them. Recommended. Resolution independent, themeable via CSS, zero extra requests, hit-testing is native (pointer events on paths), accessible via roles and labels, trivially unit-testable.
2. Raster image plus image-map or overlaid absolutely-positioned divs. Rejected: blurry on high DPI, brittle alignment, hit areas are rectangles or hand-measured polygons.
3. Canvas with manual hit-testing. Rejected: no native a11y, reinventing pointer logic.

Front/back presentation:
1. Both views side by side (stacked on narrow screens), no toggle. Recommended: all 9 zones visible at once, no hidden state, fewer interactions, simpler tests.
2. Single silhouette with a front/back toggle. Larger drawing, but needs toggle state, a toggle a11y pattern, and hides half the zones. Rejected (D4).

Zone data location:
1. A framework-free `shared/` workspace package exporting the zone list, labels and view geometry as pure TS. Recommended: matches the user's convention, HYR-27 and later bidder UI reuse it, and the geometry becomes testable without a DOM.
2. Everything inside the web app. Simpler now, but duplicates the enum once the backend DTO for HYR-27 needs the same list.

## 5. Design

### 5.1 Layout in the repo (assumption A2)

Keep the backend at the repo root untouched. Add two npm workspaces: `shared/` (name `@hyrox-sponsor/shared`) and `web/` (SvelteKit + Tailwind + Vitest, assumption A3). Root `package.json` gains `"workspaces": ["shared", "web"]` and nothing else. All new dependencies are exact-pinned. Moving the backend into `api/` is explicitly out of scope.

### 5.2 `shared/` contents

- `shared/src/body-zone.ts`: `BODY_ZONES` readonly tuple of the 9 string values and `type BodyZone = typeof BODY_ZONES[number]`. String values identical to the Prisma enum names, since that is what the HYR-27 API will carry.
- `shared/src/body-zone-labels.ts`: user-facing label per zone (`ASS` label is "Glutes", D3).
- `shared/src/body-map-geometry.ts`: per view (`front`, `back`): the viewBox, the silhouette path, and an ordered list of `{ zone, id, pathData }` hit-regions. Path data is plain strings.
- Drift guard: a backend-side test (`src/common/body-zone-contract.spec.ts`) asserting `BODY_ZONES` equals the Prisma `BodyZone` values (imports the shared package; backend has no other dependency on it). This is the only backend touch, and it is a test only.

### 5.3 Component API (assumption A5, this is what HYR-27 consumes)

`web/src/lib/body-map/BodyMap.svelte`

Props:
- `selected: BodyZone | null` (bindable; single selection).
- `zoneStates?: Partial<Record<BodyZone, { badge?: string; disabled?: boolean }>>` so HYR-27 can show a price badge or mark a zone without a floor price. Rendered as text near the region and included in the accessible name.
- `disabled?: boolean` for the whole map (read-only use later).

Events (Svelte callback prop): `onselect(zone: BodyZone)`. Selecting the already-selected zone keeps it selected (no deselect), D6.

Below the maps the component renders a single shared selected-zone chip showing the selected zone's label (e.g. "Left arm"). There is no dedicated separate area for arms/thighs (may be revisited later as a summary strip, no API change).

HYR-27 renders the price input beside the map, keyed on `selected`. The component owns zero price logic.

### 5.4 Interaction and a11y (A6)

- Each region is a `<path>` with `role="button"`, `tabindex="0"`, `aria-pressed` for selected, `aria-disabled` when disabled, and `aria-label` of the form "Left pec, front view" plus badge text. Arms and thighs have two regions on different views; each is its own tab stop and both carry the same zone semantics. Alternative with fewer tab stops (only the front region focusable) was rejected as less predictable.
- Arm and thigh regions are captioned with both views, e.g. "Left arm (front + back)"; hovering or focusing either region highlights both.
- Enter and Space activate. Tab order: front view top-to-bottom, left to right on screen, then back view.
- Visible focus ring that does not rely on color alone; selected state uses fill plus a stroke change; hover uses a lighter fill. Colors meet WCAG AA contrast against the silhouette.
- Each SVG has `role="group"` and an accessible name ("Front view", "Back view"). A visually-hidden live region announces "<zone> selected".
- Touch: hit-regions have a minimum effective size; thin regions (arms) get a transparent wider stroke as a touch target (verify in plan phase 4).
- `prefers-reduced-motion`: no transitions beyond color.

### 5.5 Illustration (A7)

A neutral, gender-neutral, stylized outline silhouette authored as SVG paths in code. I can describe and test the geometry but cannot produce final art; the plan produces a clean, geometric placeholder-quality figure that is swappable by replacing path strings in `body-map-geometry.ts` only. Per D2, no real art: basic hand-authored placeholder silhouette only.

## 6. Error handling

Pure presentational component, no I/O. Invalid `selected` (not in `BODY_ZONES`) is a TypeScript error at compile time; at runtime an unknown value renders as no selection. No exceptions thrown.

## 7. Testing

- `shared`: Vitest unit tests: nine unique zones; every zone has at least one region; the region-count table in section 3; ids unique; labels present for all zones; each view's regions only reference allowed zones (pecs front only, ass back only).
- Contract test in backend: `BODY_ZONES` equals Prisma `BodyZone` keys.
- `web` component tests (Vitest + Testing Library for Svelte, jsdom): click each of the 13 regions emits the right zone; arm click on either view selects both regions; Enter and Space activate; disabled zone does not emit; whole-map disabled does not emit; `aria-pressed` reflects selection; left/right mapping is anatomical (front-view viewer-right region is `LEFT_*`).
- Visual check: manual run in a browser (qa-verifier) at mobile and desktop widths. Automated visual regression is out of scope.

## 8. Dependency impact

New (all exact-pinned): `svelte`, `@sveltejs/kit`, `@sveltejs/adapter-*` (D7), `vite`, `tailwindcss`, `@testing-library/svelte`, `jsdom`, `typescript` already present at root. Versions are chosen at install time from the resolved lockfile; the plan does not hardcode them.

## 9. Decisions (all RESOLVED)

- D1 RESOLVED: SvelteKit + Tailwind + Vitest.
- D2 RESOLVED: basic hand-authored SVG placeholder silhouette, no real art.
- D3 RESOLVED: `ASS` UI label is "Glutes" (enum stays `ASS`).
- D4 RESOLVED: front and back side by side (stacked on narrow screens), no toggle.
- D5 RESOLVED: arms and thighs appear on both views with linked hover/select highlight across both regions, plus a caption like "Left arm (front + back)" and one shared selected-zone chip under the map. No dedicated separate area (possible later summary strip, no API change).
- D6 RESOLVED: re-clicking the selected zone keeps it selected.
- D7 RESOLVED: deploy adapter deferred; default adapter until a deploy ticket exists.
- D8 RESOLVED: `web/` and `shared/` npm workspaces beside the root backend; exact-pinned deps; no barrel files.
- D9 RESOLVED: HYR-27 API accepted as in 5.3: props `selected` (bindable), `zoneStates?` (badge, disabled), `disabled?`; event `onselect(zone)`.
- D10 RESOLVED: `LEFT_*` is the athlete's own left (viewer's right on the front view).
