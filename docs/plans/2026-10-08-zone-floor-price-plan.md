# HYR-27: Zone Floor Price Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Authenticated athletes read all nine floor prices via `GET /zone-floor-prices` and set one zone at a time via `PUT /zone-floor-prices/:zone`, with the $10 minimum, $100,000 cap and whole-dollar rule enforced in the service, and a web panel that edits the whole-dollar price of the zone selected on the body map.

**Spec:** `docs/specs/2026-10-08-zone-floor-price-design.md` (read sections 4 and 9 first).

**Status:** All spec decisions D1-D10 RESOLVED (spec section 9); ready to build. Key ones: per-zone PUT (D1), max $100,000 (D2), whole dollars only (D3), `$25` display (D4), `$10 (min)` default badge (D5), web login deferred to HYR-30 so this ticket keeps an injected token provider plus a dev-only token field (D6), any authenticated athlete (D7).

## Global constraints

- Exact-pinned deps (none expected). Style (CLAUDE.md): explicit return types, no single-letter names (except `i/j/k` in indexed loops), no inline `if`, blank line before `if/for/while/return/throw`, no `!!x`, no nested function declarations, numeric separators on 5+ digit literals (`10_000_000`; `1000` and `100` stay plain), no barrel files, `readonly` constructor params, comments only for a non-obvious why.
- Hexagonal: `*.service.ts` never imports Prisma or `src/prisma/`; only `*.db.ts` does. Errors are snake_case codes (`InvalidValueError('floor_price_below_minimum')`); readable detail goes to `this.logger.warn` at the throw site, services only; pure helpers throw code only, no logging.
- Branded types: `Cents` and `AthleteId`; no `as Cents` outside `*.db.ts` and `src/common/money.ts`. Service/db methods with two same-typed params use brands.
- Tests: Vitest, nested `describe` per condition (`when ...`), short `it` titles outcome only, shared setup in that `describe`'s `beforeEach`. Mock db with `vitest-mock-extended` as in `src/zones/zone-floor-price.service.spec.ts`.
- Git: stage each task's files with `git add`, do NOT commit; user reviews with `/crit`. Conventional Commits for any later commit, ending with the Co-Authored-By line from the session. Branch: rename to `hyr-27` before pushing or opening a PR, never after. Move Linear HYR-27 to In Progress at build start (check current state first), In Review only when staged.
- Gate after each backend task: `npm run lint`, `npm run lint:arch`, `npm test`, `npm run build`. After each web or shared task: `npm test -w shared`, `npm run check -w web`, `npm test -w web`; at the end also `npm run build -w web`.
- No Prisma schema or migration change. Do not touch `BodyMap.svelte` or its API.

## Track layout and dependencies

- **Backend track (B1-B5)** touches only `src/`. **Frontend track (F1-F5)** touches only `shared/` and `web/`. The two tracks are independent: the wire contract is fixed in spec section 4.2, and the frontend develops against an injected fake `fetch`. They can run in parallel.
- **Integration (I1-I2)** needs both tracks done: I1 is the cross-package contract test (needs `shared/src/floor-price.ts` from F1 and `src/zones/floor-price-limits.ts` from B1); I2 is manual end-to-end.
- Within a track, tasks are sequential. HYR-30 (web login) is a later ticket and replaces the dev-only token field; nothing here depends on it.

## Backend track

### Task B1: Limits module
Files: create `src/zones/floor-price-limits.ts`, `src/zones/floor-price-limits.spec.ts`; modify `src/zones/zone-floor-price.service.ts` (import the constant instead of the private const).
- [ ] Failing test: minimum equals 1000 cents; maximum equals 10_000_000 and is a valid `Cents`; maximum fits Postgres `INTEGER` (<= 2_147_483_647); step equals 100 and divides the minimum.
- [ ] Implement `PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = cents(1000)`, `MAXIMUM_FLOOR_PRICE_CENTS = cents(10_000_000)`, `FLOOR_PRICE_STEP_CENTS = 100`.
- [ ] Switch the service import; existing service spec must still pass unchanged.
- [ ] Gate; `git add` the files.

### Task B2: Db list and upsert methods
Files: modify `src/zones/zone-floor-price.db.ts`; create `src/zones/zone-floor-price.db.spec.ts` (follow an existing db spec such as `src/races/usecases/log-race/log-race.usecase.db.spec.ts` for the prisma mock style).
- [ ] Failing tests: `findAllByAthlete(athleteId)` queries `zoneFloorPrice.findMany` filtered by athlete; `upsert(athleteId, zone, floorPriceCents)` calls `zoneFloorPrice.upsert` with `where: { athleteId_zone }`, `create` and `update` both carrying `floorPriceCents`, and returns the saved row.
- [ ] Implement both. `floorPriceCents` param is `Cents`. Raw rows returned (no mapping layer). No domain throws in the db.
- [ ] Gate; `git add`.

### Task B3: Service read path
Files: modify `src/zones/zone-floor-price.service.ts`, `src/zones/zone-floor-price.service.spec.ts`.
- [ ] Define exported type `ZoneFloorPriceView = { zone: BodyZoneValue; floorPriceCents: Cents; isDefault: boolean }` and an ordered list of the nine zones. The service must not import Prisma: obtain the zone list without `@prisma/client` (for example a `ZONE_ORDER` constant of the nine string literals typed against the db signature so drift fails to compile; `src/common/body-zone-contract.spec.ts` already guards the values).
- [ ] Failing tests: `listForAthlete` when the athlete has no rows returns nine entries, all `isDefault: true` at 1000; when some rows exist returns their price with `isDefault: false` and the rest default; order is stable (enum order).
- [ ] Implement `listForAthlete(athleteId: AthleteId): Promise<ZoneFloorPriceView[]>`. `getFloorPriceCents` stays as is.
- [ ] Gate; `git add`.

### Task B4: Service write path with the $10 enforcement
Files: modify `src/zones/zone-floor-price.service.ts`, `src/zones/zone-floor-price.service.spec.ts`; add `Logger` to the service.
- [ ] Failing tests, one `describe` per condition: when price is exactly 1000 (accepted, `db.upsert` called with it); when price is 900 or 0 (rejects `InvalidValueError` code `floor_price_below_minimum`, `db.upsert` not called); when price is 999 or 1050 (`floor_price_not_whole_dollars`); when price is 10_000_000 (accepted); when price is 10_000_100 (`floor_price_above_maximum`); when price is non-integer (1000.5) or negative (-100) (`cents_invalid`); when valid (returns `{ zone, floorPriceCents, isDefault: false }`). Every rejection asserts `db.upsert` not called.
- [ ] Implement `setFloorPrice(athleteId: AthleteId, zone: BodyZoneValue, floorPriceCents: number): Promise<ZoneFloorPriceView>`. Check order is fixed: `cents()` (`cents_invalid`), whole-dollar step, minimum, maximum. Log a readable warn with athlete id and zone before each throw; throw code only. Private helper methods, no nested function declarations.
- [ ] Gate; `git add`.

### Task B5: DTOs, controller, module wiring
Files: create `src/zones/dto/zone-param.dto.ts`, `src/zones/dto/set-floor-price.dto.ts` and their `.spec.ts`, `src/zones/zone-floor-price.controller.ts` and `.spec.ts`; modify `src/zones/zones.module.ts`.
- [ ] Failing DTO tests (pattern in `src/races/dto/log-race.dto.spec.ts` and `race-entry-params.dto.spec.ts`): zone param valid for each of the nine zones, invalid for unknown or lowercase; body valid with a number; missing `floorPriceCents`, string value, and extra property fail.
- [ ] Implement: `ZoneParamDto` with `@IsIn` over the nine zones (import the Prisma enum in the DTO file only, as `log-race.dto.ts` uses its own const; if that conflicts with `lint:arch`, use a local `as const` zone map); `SetFloorPriceDto` with `@IsNumber()` only (bounds belong to the service for specific error codes, spec section 1).
- [ ] Failing controller tests (pattern in `src/races/race-entry-verification.controller.spec.ts`): `GET` calls `listForAthlete` with the token athlete id and returns `{ prices }`; `PUT :zone` calls `setFloorPrice` with token athlete id, path zone and body cents and returns the entry; both throw `UnauthorizedException('invalid_token')` when the athlete id is undefined.
- [ ] Implement `@Controller('zone-floor-prices')` with `@UseGuards(JwtAuthGuard)`, `@Get()`, `@Put(':zone')`, and the `requireAthleteId` guard. Update `ZonesModule`: `imports: [AuthModule]`, `controllers: [ZoneFloorPriceController]`.
- [ ] Gate (includes `npm run build`: confirm no circular import between `AuthModule` and `ZonesModule`); `git add`.

## Frontend track

### Task F1: Shared floor-price helpers
Files: create `shared/src/floor-price.ts`, `shared/src/floor-price.spec.ts`.
- [ ] Failing table-driven tests: `parseWholeDollarsToCents` valid (`"25"` 2500, `"$25"` 2500, `" 10 "` 1000, `"0"` 0); invalid returns `null` (`""`, `"abc"`, `"-5"`, `"10.5"`, `"10.00"`, `"1e3"`, `"1,000"`, `"."`, a 30-digit string); `floorPriceError` (999 `floor_price_not_whole_dollars`, 900 and 0 `floor_price_below_minimum`, 1000 `null`, 10_000_000 `null`, 10_000_100 `floor_price_above_maximum`; same check order as the backend); `formatCents` (2500 `$25`, 1000 `$10`).
- [ ] Implement with integer arithmetic only. Export `PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = 1000`, `MAXIMUM_FLOOR_PRICE_CENTS = 10_000_000`, `FLOOR_PRICE_STEP_CENTS = 100`, and the error-code union type. Import types with `.ts` extensions as the other shared files do.
- [ ] `npm test -w shared`, `npm run check -w shared`; `git add`.

### Task F2: API client
Files: create `web/src/lib/floor-price/floor-price-api.ts` and `.spec.ts`.
- [ ] Failing tests with a fake `fetch`: `getFloorPrices` sends `GET {baseUrl}/zone-floor-prices` with `Authorization: Bearer <token>` and returns `prices`; `saveFloorPrice(zone, floorPriceCents)` sends `PUT {baseUrl}/zone-floor-prices/{zone}` with JSON body `{ floorPriceCents }` and returns the single saved entry; non-2xx rejects with a `FloorPriceApiError` carrying `status` and the server `message` code (falls back to `request_failed` when the body is not JSON); missing token rejects with code `not_authenticated` without calling fetch.
- [ ] Implement `createFloorPriceApi({ baseUrl, getAccessToken, fetchImpl = fetch })`. The `getAccessToken` seam is what HYR-30 plugs real login into.
- [ ] Checks; `git add`.

### Task F3: State helpers
Files: create `web/src/lib/floor-price/floor-price-state.ts` and `.spec.ts`.
- [ ] Failing tests: `zoneStatesFromPrices(prices)` gives badge `$25` for a saved price and `$10 (min)` for a default entry; `draftError(text)` returns `null` for an empty draft (untouched), `invalid_amount` for unparsable (including decimals), otherwise the shared `floorPriceError` code; `errorCopy(code)` maps `floor_price_below_minimum` to "Minimum floor price is $10.", plus `floor_price_above_maximum`, `floor_price_not_whole_dollars`, `cents_invalid`, `validation_failed`, `not_authenticated`, `invalid_amount`, and a generic fallback.
- [ ] Implement as pure functions (no Svelte imports). Copy builds the minimum and maximum text from the shared constants via `formatCents`, not literals.
- [ ] Checks; `git add`.

### Task F4: Panel component
Files: create `web/src/lib/floor-price/ZoneFloorPricePanel.svelte` and `ZoneFloorPricePanel.spec.ts` (pattern: `web/src/lib/body-map/BodyMap.spec.ts`).
- [ ] Failing component tests (Testing Library + user-event), one `describe` per condition: when no zone is selected (prompt text, no input); when a zone is selected (labelled input "Left pec floor price", shows the saved price in whole dollars, `inputmode="numeric"`); when the draft is below $10 (error text with `aria-invalid`, Save disabled); when the draft has a decimal point (error, Save disabled); when the draft is valid and changed (Save enabled; click calls `onsave(zone, cents)` once with the selected zone and cents); when the draft is unchanged (Save disabled); when save fails with a server code (mapped copy shown, draft kept); when switching zones (the first zone's unsaved draft survives); when saving (button disabled, polite live region announces result).
- [ ] Implement as a presentational component: props `selected: BodyZone | null`, `prices` (saved view), `onsave(zone, floorPriceCents): Promise<void>`, `disabled?`. It owns drafts and local validation via F1/F3 helpers; it does no fetching. Tailwind classes consistent with the dev harness; visible focus, label tied to input, `aria-describedby` for hint and error.
- [ ] Checks; `git add`.

### Task F5: Wire the harness route
Files: modify `web/src/routes/dev/body-map/+page.svelte` (replaces the throwaway input); add a route test only if a testing pattern already exists for routes, otherwise keep the page thin and rely on F2-F4 tests plus I2.
- [ ] Mount `BodyMap` bound to `selected`, `zoneStates` from `zoneStatesFromPrices`, and `ZoneFloorPricePanel`; on mount call `getFloorPrices`; `onsave` calls `saveFloorPrice(zone, cents)` then replaces that zone's saved entry from the response.
- [ ] Config: API base URL from a public env var (`import.meta.env.VITE_API_BASE_URL`; SvelteKit 3.0.1 has no `$env/dynamic/public`), documented in `.env.example` if one exists for web. Dev-only access token text field on the page feeds `getAccessToken` (D6); label it as a stopgap until HYR-30 (real web login), no persistence to storage. Verify the backend `CORS_ORIGINS` env includes the web dev origin and note it in the README or `.env.example`.
- [ ] Checks including `npm run build -w web`; `git add`.

## Integration

### Task I1: Constants contract test
Depends on B1 and F1.
Files: create `src/zones/floor-price-contract.spec.ts` (pattern: `src/common/body-zone-contract.spec.ts`).
- [ ] Test: shared `PLATFORM_MINIMUM_FLOOR_PRICE_CENTS`, `MAXIMUM_FLOOR_PRICE_CENTS` and `FLOOR_PRICE_STEP_CENTS` equal the backend constants. Test-only import of shared; no runtime backend import (spec section 4.4).
- [ ] Root gate; `git add`.

### Task I2: End-to-end check (hand to qa-verifier)
- [ ] Start Postgres (host port 5435), run migrations, start backend and web. Sign up and log in to get a token, paste it in the harness dev field.
- [ ] Set prices on three zones (one Save each); reload; badges and inputs show persisted prices. Zones not set show `$10 (min)`.
- [ ] Enter $9 in the UI: blocked. Enter 10.5: blocked (no decimals). `curl -X PUT` on `/zone-floor-prices/LEFT_PEC` with 900: 400 `floor_price_below_minimum`; 999: 400 `floor_price_not_whole_dollars`; 1050: 400 `floor_price_not_whole_dollars`; 10_000_100: 400 `floor_price_above_maximum`; 1000 and 10_000_000: 200. Repeating the same PUT is idempotent (200, one row).
- [ ] Unknown zone in the path: 400 `validation_failed`. No Authorization header: 401 `invalid_token`.
- [ ] Mobile width: input and Save usable below the map.
- [ ] Update Linear HYR-27 to In Review only after staging is complete.

## Self-review notes

- Spec coverage: storage (no change, 4.1), API (B2-B5), service enforcement of minimum, cap and whole dollars (B4), shared constants and UI parse (F1, F3), per-zone input on the selected zone (F4-F5), contract tie (I1), error table (B4/B5/I2).
- D10 (raising the minimum later needs a data migration bumping rows below the new minimum before the CHECK changes) is documentation only in the spec; no task.
- B3's zone-list approach and B5's DTO enum import are the two spots where the Prisma-free service rule and `lint:arch` might force a small local adjustment; the tasks name the fallback.
