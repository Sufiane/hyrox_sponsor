# HYR-5: Race Logging Flow (name, date, division) - Design Spec

Status: Draft, design decisions resolved by the planning agent without interactive Q&A (see section 9); needs coordinator/user confirmation
Ticket: Linear HYR-5 (project "Hyrox Sponsor - MVP", milestone M1 - Listing & Body Map). Ticket description is empty; scope inferred from the title.
Date: 2026-10-01
Depends on: HYR-2 (core data model, merged at 01634d6)

## 1. Context

An athlete logs a race they are entering (or have run) by giving its name, date and
division. Logging creates a `RaceEntry` (athlete + race) in `PENDING` verification.
Bib upload and verification are HYR-6; auction creation is HYR-8. This ticket is the first
HTTP surface for races; request validation uses the global `ValidationPipe` and class-validator DTOs from HYR-3.

HYR-2 left this ticket two explicit obligations (core-data-model spec, section 8):
`raceLocalDate` must come from one shared timezone-aware helper, unit-tested near
midnight, stored as a UTC-midnight `Date`.

Scope: backend API only. The repo has no frontend; nothing in this ticket is frontend work.

## 2. Gaps in the HYR-2 schema this ticket must close

1. No division anywhere. A Hyrox event has many divisions, so division belongs on
   `RaceEntry` (what this athlete is running), not `Race`.
2. `RaceEntry.bibNumber` is `NOT NULL`, but at logging time the athlete has no bib
   (bib/confirmation upload is HYR-6). Make it nullable.
3. `Race.timezone` and `Race.location` are required and the title does not mention them.
   Timezone is needed to compute `raceLocalDate`, and the auction window (HYR-8) depends on
   it, so they stay required and become request fields.

4. No way to identify "the same event" across athletes. Add `Race.nameKey` (trimmed,
   whitespace runs replaced by `_`, lowercased `name`, e.g. `Hyrox  Chicago` -> `hyrox_chicago`; computed by the usecase, never by the DB) and
   `@@unique([nameKey, date, timezone])` so races are shared safely under concurrency. (The
   Race start-instant column is `date`; it is not renamed.)

All schema changes ship in one new migration (`add_race_entry_division_and_race_name_key`);
the HYR-2 init migration is already merged and must not be edited. The migration must not
drop or erase the HYR-2 hand-written objects (the `floor_price_cents >= 1000` CHECK and the
partial unique index `bid_one_leading_per_auction`): the generated SQL is hand-edited to strip
any such `DROP`, and the README shadow-database `prisma migrate diff` check must report
`-- This is an empty migration.`. `name_key` is added nullable, backfilled with
`lower(regexp_replace(regexp_replace(name, '^\s+|\s+$', '', 'g'), '\s+', '_', 'g'))`, then set `NOT NULL`, in case `races`
rows exist.

## 3. API

Auth does not exist yet (HYR-3). The athlete is identified by a path parameter now;
HYR-3 replaces it with the authenticated athlete id and drops the path segment.

`POST /athletes/:athleteId/race-entries`

Request body (JSON):

| field | type | rule |
|---|---|---|
| `name` | string | trimmed, internal whitespace collapsed, 1-120 chars |
| `date` | string | ISO 8601 datetime with explicit offset or `Z` (race start instant) |
| `timezone` | string | IANA id, validated via `ianaTimezone()` |
| `location` | string | trimmed, 1-120 chars |
| `division` | string | one of the `RaceDivision` values (section 4) |

Response `201`: the created `RaceEntry` with its `race` included (Prisma record, no mapping
layer): `verificationStatus: "PENDING"`, `bibNumber: null`, `raceDate`, `raceLocalDate`, `division`.

Errors (snake_case codes; `src/common` helpers throw `InvalidValueError`, the usecase throws `NotFoundError`/`ForbiddenError`/`ConflictError` (all `DomainError`s mapped by `DomainErrorFilter`) and logs a warn line for not-found, banned and conflict). Body field failures (name, date, location, division, wrong types, unknown fields) all surface as `400 validation_failed` from the global pipe; the readable detail is logged:

| status | code | when |
|---|---|---|
| 400 | `athlete_id_invalid` | blank path id |
| 400 | `validation_failed` | name/location empty, too long or not a string; date not an ISO datetime with offset, calendar-invalid (Feb 30), or outside 2017-01-01..now+2y; division not in the enum; unknown field |
| 400 | `iana_timezone_invalid` | timezone is a string but not a valid IANA id |
| 404 | `athlete_not_found` | unknown athlete |
| 403 | `athlete_banned` | `isBanned` athlete |
| 409 | `race_entry_date_conflict` | athlete already has an entry on that local calendar date |

Validation order: id, then body fields in table order (first failure wins), then athlete
lookup, then write.

## 4. Divisions

New Prisma enum `RaceDivision` (`@@map("race_division")`), 12 values:

```
SINGLE_OPEN_MEN  SINGLE_OPEN_WOMEN  SINGLE_PRO_MEN  SINGLE_PRO_WOMEN
DOUBLES_OPEN_MEN DOUBLES_OPEN_WOMEN DOUBLES_OPEN_MIXED
DOUBLES_PRO_MEN  DOUBLES_PRO_WOMEN
RELAY_MEN        RELAY_WOMEN        RELAY_MIXED
```

Native Postgres enum, consistent with the other enums. Adding a value later is a one-line
migration. The service never imports the Prisma enum: it declares a local `as const`
`DIVISION` object (same pattern as `VERIFICATION_STATUS`) and a `RaceDivisionCode` type.

## 5. Architecture

Logging is multi-step (parse, athlete standing check, local-date computation, find-or-create
race, create entry in one transaction, conflict mapping), so it is a usecase per the
CLAUDE.md usecase convention. Direction: controller -> `RaceEntryService.logRace` (thin
delegate) -> `LogRaceUsecase.execute` -> `LogRaceUsecaseDb`.

```
src/common/local-date.ts           localDateInTimezone(instant, tz) -> UTC-midnight Date
src/common/ids.ts                  + RaceEntryId, athleteId(value) validating constructor
src/common/prisma-error-codes.ts   UNIQUE_VIOLATION ('P2002'), shared by db files
src/athletes/dto/athlete-params.dto.ts  path param DTO: athleteId() brands it, InvalidValueError('athlete_id_invalid')
src/races/race-entry.controller.ts POST /athletes/:athleteId/race-entries
src/races/race-entry.service.ts    + logRace delegate (existing isVerified untouched)
src/races/usecases/log-race/
  log-race.usecase.ts              parse + orchestrate, ORM-free
  log-race.usecase.db.ts           the only ORM file for this usecase
src/races/race-name-key.ts         raceNameKey(name) -> trimmed, lowercased, whitespace runs -> '_'
src/races/dto/log-race.dto.ts      class-validator body DTO (+ race-date.ts: ISO/calendar parse, range validator)
src/races/usecases/log-race/log-race.module.ts  provides usecase + its db, exports only the usecase
src/races/races.module.ts          + controller, imports LogRaceModule
```

The usecase has its own narrow db (athlete standing read + transactional write); it does not
depend on `AthleteDb` or `RaceEntryDb`, which keeps the HYR-2 modules untouched. The athlete
standing read duplicating a `findUnique` is accepted to keep the usecase self-contained.

### 5.1 Usecase flow

1. Receives the already-validated `LogRaceDto` (`name`, `date: Date`, `timezone: IanaTimezone`, `location`, `division`) from the global `ValidationPipe`.
2. `db.findAthleteStanding(athleteId)`; null -> `athlete_not_found` (warn log); `isBanned` -> `athlete_banned` (warn log).
3. `raceLocalDate = localDateInTimezone(date, timezone)`.
4. `db.createEntry({ athleteId, race: { name, date, timezone, location }, division, raceLocalDate })`:
   - inside one `$transaction`: find the `Race` by the unique key `(nameKey, date, timezone)`. If missing, insert it with `createMany({ skipDuplicates: true })` (SQL `INSERT ... ON CONFLICT DO NOTHING`), then re-find by the same key and reuse that row. A concurrent insert of the same race therefore never errors and never aborts the transaction. Then create the `RaceEntry` with `raceDate = date`, `raceLocalDate`, `division`, `bibNumber` null.
   - Why not catch `P2002` on the race insert and re-find: in Postgres a failed statement aborts the whole transaction, so the re-find would fail with "current transaction is aborted". `ON CONFLICT DO NOTHING` gives the same reuse semantics without aborting.
   - The only `P2002` that can still occur is the `RaceEntry` `(athlete_id, race_local_date)` index. The db returns `null` only when the error's `meta.target` names `race_local_date`; any other `P2002` or error rethrows. The transaction rolls back, so a `Race` created in the same call is not left behind. No domain throws in the db.
5. null -> `race_entry_date_conflict` (409, warn log with athlete id and local date). Otherwise return the entry with `race`.

### 5.2 Local-date helper

`localDateInTimezone(instant: Date, tz: IanaTimezone): Date` formats the instant in `tz` via
`Intl.DateTimeFormat` `formatToParts` (year/month/day) and returns
`new Date(Date.UTC(y, m - 1, d))`. Pure, in `src/common`, no logging, no Prisma. Tests cover
a UTC instant that is the previous/next local day (e.g. 2026-11-15T03:30Z in
`America/Chicago` is 2026-11-14), DST change days, and a date-line zone (`Pacific/Auckland`).

### 5.3 Branded types

Add `RaceEntryId`. Add `athleteId(value: string): AthleteId` (trim, non-empty, max 64,
throws `InvalidValueError('athlete_id_invalid')`), used only by `AthleteParamsDto`, the HTTP boundary.
Timezone is branded through the existing `ianaTimezone()`. Race name, location and
`division` are not branded (free text / enum-like). The usecase db is the only place that
casts the returned ids.

## 6. Behaviour decisions worth knowing

- Race rows are shared: two athletes logging the same event reuse one `Race`, keyed by
  `(nameKey, date, timezone)` and enforced by a DB unique index, including under concurrent
  first logs. The location of an existing race is not overwritten by a later logger. Typos in
  the name still produce distinct races; fixing that is a staff/merge concern, not this ticket.
- One entry per athlete per local calendar day, enforced by the HYR-2 unique index; the
  same athlete logging the same race twice gets 409 (not idempotent).
- Past races are allowed (locked product context: past results are self-reported). Range
  guard only: 2017-01-01 <= date <= now + 2 years. Whether an entry is auction-eligible
  (future, window not passed) is HYR-8's concern.
- Entry starts `PENDING`; nothing here sets verification fields.

## 7. Testing

Vitest, project conventions (nested `describe` per condition, short `it`s, `mockDeep` db).

- `local-date.spec.ts`: plain helper tests, near-midnight cases.
- `log-race.dto.spec.ts` (through `createValidationPipe()`): one `describe` per field rule, calendar-invalid and leap-day dates, range with fake timers.
- `race-name-key.spec.ts`: trim, lowercase, whitespace runs to `_`, punctuation kept.
- `log-race.usecase.spec.ts`: athlete missing, banned, happy path (db called with computed
  local date, parsed values and the normalized `nameKey`), db returns null -> 409; warn logs asserted.
- `log-race.usecase.db.spec.ts` (`PrismaService` mocked, `$transaction` runs its callback
  against a mock `tx`): existing race reused without insert; missing race inserted then
  re-found; concurrent insert (`createMany` count 0, re-find returns the other writer's row)
  reused; entry-date `P2002` returns `null`; `P2002` on another target and non-`P2002` errors
  rethrow.
- `race-entry.service.spec.ts`: add `logRace` delegation test.
- `race-entry.controller.spec.ts`: delegates params/body to the service.
- `athlete-params.dto.spec.ts`, `ids` constructor spec, `domain-error.filter.spec.ts` (404/403/409).
- Manual smoke against local Postgres (docker compose, port 5435): POST happy path, same
  date conflict, unknown athlete. No HTTP/e2e test harness exists and none is added.

Gates: `npm run build && npm run lint && npm run lint:arch && npm test`, plus the README
shadow-database `prisma migrate diff` check (expect no DROP of the hand-written objects).

## 8. Out of scope

- Authentication/authorization of this endpoint (HYR-3 landed the auth stack but this route is not guarded yet).
- Bib number entry, verification document upload, verification review (HYR-6).
- Listing/reading entries, editing or deleting an entry, race search/autocomplete.
- Auction creation and scheduling (HYR-8). Any frontend.

## 9. Judgment calls made without interactive confirmation

1. **Division lives on `RaceEntry`**, as a 12-value native enum (singles/doubles/relay x open/pro x gender). List is editable cheaply; confirm the exact set.
2. **`bibNumber` becomes nullable.** Alternative (require bib at log time) contradicts "name, date, division" and HYR-6 owning bib.
3. **Request also carries `timezone` and `location`**, because `Race` requires them and timezone drives `raceLocalDate` and the auction window. Alternative: pick from a pre-seeded race catalog (no free-text races); rejected as outside the title's scope.
4. **class-validator DTOs + the global `ValidationPipe`** (changed after review; the original hand parser was dropped). Cost: field errors collapse to one `validation_failed` code, accepted for consistency with auth.
5. **Athlete identity from the path** (`/athletes/:athleteId/...`) as a temporary stand-in for auth. Anyone can log a race for any athlete until HYR-3 lands; acceptable only because nothing is deployed.
6. **Race reuse via `Race.nameKey` + `@@unique([nameKey, date, timezone])`** (user-directed). Race find-or-create uses insert-with-`ON CONFLICT DO NOTHING` then re-find instead of catching `P2002`, because Postgres aborts the transaction on a failed insert (section 5.1).
7. **Date range guard 2017-01-01 to now+2y.** Numbers are arbitrary-but-sane (Hyrox's first event was 2017).
8. **Usecase layer used from the start** (multi-step, transactional), with its own narrow db rather than reusing `RaceDb`/`RaceEntryDb`.
9. **Banned athletes cannot log** (403); `isAdult` is not checked here (18+ attestation belongs with signup/listing).
10. **New migration, not an edit of init**, because init is merged. The `division` column is `NOT NULL` with no default; safe because no code created `RaceEntry` rows before this ticket.
