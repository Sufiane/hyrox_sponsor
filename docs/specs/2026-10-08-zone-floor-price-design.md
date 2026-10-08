# HYR-27: Per-zone Floor Price Input, $10 Platform Minimum Enforced - Design

Status: APPROVED, all decisions resolved (section 9). Linear HYR-27 has no description; this spec is inferred from the title, the core data model spec (sections 5.3 and 5.5), the body map spec (HYR-7), and the repo. Blocked by HYR-7 (done). Blocks HYR-9 (bid placement) and HYR-8 (auction scheduling). Milestone: M1 - Listing & Body Map.

## 1. Context and findings

- The storage is already modelled. Prisma `ZoneFloorPrice` (`zone_floor_prices`): `athleteId`, `zone` (`BodyZone`), `floorPriceCents Int`, unique `(athleteId, zone)`. A hand-written migration already adds `CHECK (floor_price_cents >= 1000)` (`floor_price_minimum_1000_cents`) as the DB backstop. No schema or migration change is needed.
- Floor prices are per athlete and zone, not per race entry. `Auction.floorPriceCents` is a snapshot copied at auction-open time (HYR-8), so editing a floor never retroactively changes an existing auction.
- `src/zones/` has `ZoneFloorPriceDb.findFloorPriceCents` and `ZoneFloorPriceService.getFloorPriceCents`, which already falls back to `PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = cents(1000)` (module-private const) when no row exists. HYR-8 will consume that read. There is no write path, no controller, and no DTO.
- Validation pipe (`createValidationPipe`) collapses all class-validator failures to the generic `validation_failed`. So business rules that need a specific code (the $10 minimum, the cap, whole dollars) must be thrown from the service as `InvalidValueError` (mapped to 400 by `DomainErrorFilter`), not expressed as DTO decorators.
- Auth pattern for athlete-owned actions: `JwtAuthGuard` + `@CurrentAthleteId()` (see `RaceEntryVerificationController`). The athlete id comes from the token, never the path. (The older `POST athletes/:athleteId/race-entries` path-id route is a documented stand-in; do not copy it.)
- Frontend: `web/` has `BodyMap.svelte` (props `selected` bindable, `zoneStates` with `badge`/`disabled`, `disabled`; callback `onselect`) and a dev harness `web/src/routes/dev/body-map/+page.svelte` containing a throwaway `<input type="number" min="10">`. `web/` has no API client, no auth/login UI, no token storage (real login is HYR-30, section 9 D6). `shared/` is a source-only workspace (`exports: "./*": "./src/*.ts"`), imported by `web/` and by backend tests only. It is not built to JS, so backend runtime code cannot import it (the compiled `dist/` would require `.ts`).

## 2. Goal and non-goals

Goal: any authenticated athlete can view and set a floor price per body zone. Selecting a zone on the body map reveals a whole-dollar price input for it; Save persists that one zone; the $10 platform minimum is enforced on the server (authoritative) and mirrored in the UI (fast feedback). Unset zones read as the $10 minimum.

Non-goals: auction creation or snapshotting the floor (HYR-8), bid increments (HYR-9), login/signup UI (HYR-30), per-race-entry overrides, per-zone enable/disable ("do not sell this zone"), currency other than USD, final visual design.

## 3. Approaches considered

Write API shape (decided, D1):
1. Per-zone `PUT /zone-floor-prices/:zone` with body `{ floorPriceCents }`: idempotent upsert of one row. Chosen: matches the one-zone-at-a-time UI, simplest validation and error surface, safe to retry.
2. Bulk `PATCH` upserting several zones atomically. Rejected by the product owner: more surface than the UI needs.
3. `PUT` replace-all of the nine zones. Rejected: forces the client to know all nine prices and silently resets unmentioned ones.

Where the $10 minimum lives:
1. Service (authoritative) + DB CHECK (existing backstop) + a constant in `shared/` for the UI, with a contract test tying the backend and shared constants. Chosen.
2. Backend imports the constant from `shared/`. Rejected: `shared` is TS source only, so the compiled backend cannot load it at runtime. Making `shared` a built package is out of scope.
3. UI-only. Rejected: not enforcement.

## 4. Design

### 4.1 Data model

No schema change. `ZoneFloorPrice` is the store. Semantics: no row means "athlete has not set a price"; reads report the platform minimum with `isDefault: true`. Rows are never deleted by this ticket; setting a price to exactly $10 stores 1000.

### 4.2 Wire format

All money crosses the wire as integer cents (`floorPriceCents`), never decimal dollars, even though only whole dollars are accepted (D3). The UI converts whole dollars to cents (`dollars * 100`).

`GET /zone-floor-prices` (JWT) returns all nine zones, ordered by the enum order:

```json
{ "prices": [ { "zone": "LEFT_PEC", "floorPriceCents": 2500, "isDefault": false },
              { "zone": "RIGHT_PEC", "floorPriceCents": 1000, "isDefault": true } ] }
```

`PUT /zone-floor-prices/:zone` (JWT), body `{ "floorPriceCents": 2500 }`. Idempotent upsert of that athlete's row for `:zone`. Returns 200 with the single saved entry `{ "zone": "LEFT_PEC", "floorPriceCents": 2500, "isDefault": false }`. The client updates its local state from the response; it does not need to refetch.

Request rules: `:zone` must be one of the nine values (path DTO, same pattern as `RaceEntryParamsDto`); body has exactly `floorPriceCents`, a number; no unknown properties (pipe has `forbidNonWhitelisted`). Structurally wrong yields the generic 400 `validation_failed`. Business rules below yield specific codes.

### 4.3 Backend structure (hexagonal, no usecase layer)

Simple read plus a validated upsert: a service-to-db passthrough with validation, so no usecase folder (per the convention, do not retrofit).

- `src/zones/floor-price-limits.ts`: `PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = cents(1000)` (moved out of the service so the service and the contract test share it), `MAXIMUM_FLOOR_PRICE_CENTS = cents(10_000_000)` ($100,000, D2; fits Postgres `INTEGER`, max 2,147,483,647), and `FLOOR_PRICE_STEP_CENTS = 100` (whole dollars, D3).
- `src/zones/zone-floor-price.db.ts` (only ORM file): add `findAllByAthlete(athleteId)` returning rows, and `upsert(athleteId, zone, floorPriceCents)` using `prisma.zoneFloorPrice.upsert` keyed on `athleteId_zone`, returning the saved row. Existing `findFloorPriceCents` unchanged. Brands applied here for scalar reads only, rows otherwise returned raw.
- `src/zones/zone-floor-price.service.ts`: add `listForAthlete(athleteId)` (merges the nine zones with rows, applying the default) and `setFloorPrice(athleteId, zone, floorPriceCents)`:
  - builds `cents(value)` (throws `cents_invalid` for non-integers or negatives);
  - enforces `>= minimum` (`floor_price_below_minimum`), `<= maximum` (`floor_price_above_maximum`), and `value % 100 === 0` (`floor_price_not_whole_dollars`);
  - check order: `cents_invalid`, then whole dollars, then minimum, then maximum. So 999 reports `floor_price_not_whole_dollars`, 900 and 0 report `floor_price_below_minimum`, 1000 is accepted. The order is fixed in tests;
  - logs a readable warn with athlete id and zone at the throw site, throws `InvalidValueError` with the snake_case code only;
  - calls `db.upsert` and returns the saved entry as a `ZoneFloorPriceView` with `isDefault: false`.
  - Zone type follows the existing pattern (derive from the db signature) so the service does not import Prisma.
- `src/zones/dto/zone-param.dto.ts` (zone in the path, `@IsIn` over the nine values) and `src/zones/dto/set-floor-price.dto.ts` (`@IsNumber()` on `floorPriceCents`). Business bounds are NOT decorators.
- `src/zones/zone-floor-price.controller.ts`: `@Controller('zone-floor-prices')`, `@UseGuards(JwtAuthGuard)`, `@Get()`, `@Put(':zone')`, `@CurrentAthleteId()` with the same `requireAthleteId` guard as `RaceEntryVerificationController`. `ZonesModule` gains `controllers` and imports `AuthModule` (as `RacesModule` does).
- Who may call: any authenticated athlete (D7), no bib-verification check.

### 4.4 Shared package

`shared/src/floor-price.ts` (pure, framework-free, no barrel):
- `PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = 1000`, `MAXIMUM_FLOOR_PRICE_CENTS = 10_000_000`, `FLOOR_PRICE_STEP_CENTS = 100`.
- `parseWholeDollarsToCents(text): number | null`: trims, accepts digits only with an optional leading `$` (no decimals, no separators, no signs, no exponent); empty or invalid gives `null`; guards against absurdly long digit strings before converting. Integer arithmetic.
- `floorPriceError(cents): 'floor_price_not_whole_dollars' | 'floor_price_below_minimum' | 'floor_price_above_maximum' | null`, same snake_case codes and same check order as the backend so the UI maps local and server errors through one table.
- `formatCents(cents): string` for whole-dollar amounts only (`2500` to `$25`, `1000` to `$10`) (D4).

Contract test in the backend (`src/zones/floor-price-contract.spec.ts`, mirrors `body-zone-contract.spec.ts`): shared minimum, maximum and step equal the backend constants. Backend tests may import shared; runtime code may not.

### 4.5 Web UI

Consumes the HYR-7 body map as-is; no BodyMap API changes.

- `web/src/lib/floor-price/floor-price-api.ts`: typed client for the two endpoints (`getFloorPrices`, `saveFloorPrice(zone, floorPriceCents)`). Takes `{ baseUrl, getAccessToken }` so tests inject fetch and a fake token. Maps non-2xx to a typed error carrying the server's `message` code. The injected `getAccessToken` stays as the seam HYR-30 (real login) plugs into.
- `web/src/lib/floor-price/floor-price-state.ts`: pure helpers (draft text per zone, derive `zoneStates` badges from saved prices, error copy mapping).
- `web/src/lib/floor-price/ZoneFloorPricePanel.svelte`: `selected` zone comes from the parent (bound to `BodyMap`). For the selected zone shows a labelled whole-dollar input (`type="text"`, `inputmode="numeric"`, `$` prefix, hint "Whole dollars, minimum $10"; no decimal point accepted), inline error (local validation as the user types, server code on save failure mapped to copy), and a Save button disabled while invalid, unchanged or saving. Save sends one `PUT` for the selected zone only. Empty selection shows "Choose a zone on the map."
- Drafts are per zone: an unsaved edit survives switching zones, but each Save persists only the currently selected zone.
- `BodyMap` `zoneStates` badges show the saved price per zone (`$25`); zones with no saved price show `$10 (min)` (D5).
- Replaces the throwaway input in the dev harness `web/src/routes/dev/body-map/+page.svelte`, which has a dev-only access token field feeding `getAccessToken`, marked as a stopgap until HYR-30 delivers real login (D6).
- a11y: input has a visible label naming the zone ("Left pec floor price"), error text linked with `aria-describedby` and `aria-invalid`, save result announced via a polite live region.

### 4.6 Data flow

Load: panel mounts, GET prices, set badges. Edit: parse whole dollars to cents locally, show local error from `floorPriceError`. Save: PUT the selected zone; on 200 replace that zone's saved entry from the response and clear its draft; on 400 show mapped error for the code and keep the draft; on 401 surface "session expired" (login is HYR-30).

## 5. Error handling summary

| Case | Layer | Result |
|---|---|---|
| Not logged in | guard | 401 `invalid_token` |
| Unknown `:zone`, missing or non-number `floorPriceCents`, unknown property | DTO | 400 `validation_failed` |
| Non-integer or negative cents | service via `cents()` | 400 `cents_invalid` |
| Not a multiple of 100 cents | service | 400 `floor_price_not_whole_dollars` |
| Below $10 (whole dollars, e.g. 500, 0) | service | 400 `floor_price_below_minimum` |
| Above $100,000 | service | 400 `floor_price_above_maximum` |
| Direct SQL below 1000 | DB CHECK | constraint error (backstop only) |

Note 0 is a multiple of 100, so it reports `floor_price_below_minimum`.

## 6. Testing

Backend (Vitest, nested `describe` per condition, db mocked with `vitest-mock-extended` as in `zone-floor-price.service.spec.ts`):
- service `setFloorPrice`: exactly 1000 accepted; 900 rejected `floor_price_below_minimum`; 999 rejected `floor_price_not_whole_dollars`; 0 rejected `floor_price_below_minimum`; 1050 rejected `floor_price_not_whole_dollars`; 10_000_000 accepted; 10_000_100 rejected `floor_price_above_maximum`; 1000.5 and -100 rejected `cents_invalid`; every rejection means `db.upsert` not called; valid returns the saved view with `isDefault: false`. `listForAthlete`: nine zones in enum order, defaults flagged.
- DTO specs: body valid; missing, string, extra property fail; zone param valid for each of nine values, invalid for unknown.
- controller spec: GET wraps `{ prices }`; PUT delegates with token athlete id and path zone; both give 401 when the athlete id is undefined.
- contract spec: shared constants equal backend constants.
- db spec: `upsert` keyed by `athleteId_zone` with create and update carrying the price.

Shared: `parseWholeDollarsToCents` table (valid `"25"`, `"$25"`, `" 10 "`; invalid `""`, `"abc"`, `"-5"`, `"10.5"`, `"10.00"`, `"1e3"`, `"1,000"`, absurdly long digits), `floorPriceError` boundaries and order, `formatCents`.

Web (Vitest + Testing Library): panel shows prompt when nothing selected; below $10 shows error and disables Save; decimal input rejected; valid value enables Save; Save calls the client once with the selected zone and cents; server error code shows mapped copy; drafts survive zone switching; badges reflect saved prices and `$10 (min)` defaults.

Manual (qa-verifier): run backend plus web, set a price, reload and confirm persistence; try $9 in the UI and `curl -X PUT` with 999, 900, 1050 and 10_000_100 (expect the codes in section 5).

## 7. Dependency impact

None expected. No new packages. If one is needed, exact-pin it.

## 8. Cross-ticket contracts

- HYR-8 reads floors through `ZoneFloorPriceService.getFloorPriceCents` (unchanged signature, still defaults to the minimum) at auction-open and snapshots into `Auction.floorPriceCents`.
- HYR-9 treats `Auction.floorPriceCents` as the minimum opening bid. Floors are whole dollars, but not necessarily multiples of $5, which HYR-9's increments must tolerate.
- HYR-30 (web login) replaces the dev-only token field by supplying `getAccessToken`.

## 9. Decisions (all RESOLVED)

- D1 RESOLVED: per-zone `PUT /zone-floor-prices/:zone`, idempotent upsert, no bulk PATCH. `GET` returns all 9 zones. UI: select zone on BodyMap, type price, Save sends one PUT for that zone.
- D2 RESOLVED: maximum floor $100,000 (10_000_000 cents); fits Postgres `INTEGER` (max 2,147,483,647 cents, about $21.4M). Error `floor_price_above_maximum`.
- D3 RESOLVED: whole dollars only. Cents stay on the wire; the service rejects non-multiples of 100 with `floor_price_not_whole_dollars`. UI input is an integer number of dollars, no decimals.
- D4 RESOLVED: display `$25` (whole dollars only; no `$25.50` branch).
- D5 RESOLVED: zones with no saved price show `$10 (min)`.
- D6 RESOLVED: real web login is HYR-30, following this ticket. This ticket keeps the injected `getAccessToken` client plus a dev-only token field on the dev harness; HYR-30 replaces the field.
- D7 RESOLVED: any authenticated athlete, no bib-verification requirement (floors apply to future auctions).
- D8 RESOLVED: route `/zone-floor-prices`, athlete from the JWT.
- D9 RESOLVED: minimum (and maximum, step) constants duplicated in `src/zones/floor-price-limits.ts` and `shared/src/floor-price.ts`, tied by a contract test, because `shared` is not runtime-importable.
- D10 RESOLVED (documentation only, no code now): raising the platform minimum later requires a data migration that first bumps every `zone_floor_prices` row below the new minimum, then replaces the `floor_price_minimum_1000_cents` CHECK constraint, in that order (the CHECK would otherwise reject the migration or the existing rows). The backend and shared constants and the contract test change in the same release.
