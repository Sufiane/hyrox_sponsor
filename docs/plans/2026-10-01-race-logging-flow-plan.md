# HYR-5: Race Logging Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Post-review changes (supersede the task text below where they differ):** usecase has its own `LogRaceModule`; usecase throws `NotFoundError`/`ForbiddenError`/`ConflictError` (`DomainError`) instead of Nest exceptions; `AthleteIdPipe` and `log-race-input.ts` are replaced by class-validator DTOs (`AthleteParamsDto`, `LogRaceDto`) under the global `ValidationPipe`; `raceNameKey` is snake_case (`hyrox_chicago`, backfill `lower(regexp_replace(regexp_replace(name, '^\s+|\s+$', '', 'g'), '\s+', '_', 'g'))`); `UNIQUE_VIOLATION` lives in `src/common/prisma-error-codes.ts`; `localDateInTimezone` fixes calendar and numbering system; `AthleteStanding` is `{ isBanned }`; `.js` import extensions are gone.

**Goal:** `POST /athletes/:athleteId/race-entries` lets an athlete log a race (name, date, timezone, location, division), creating or reusing a `Race` and a `PENDING` `RaceEntry`.

**Architecture:** One new migration adds `RaceDivision` and `RaceEntry.division`, makes `bibNumber` nullable, and adds `Race.nameKey` with `@@unique([nameKey, date, timezone])` (backfilled, hand-edited to keep HYR-2's hand-written constraints). Logging is a usecase (`races/usecases/log-race/`) with its own narrow db; `RaceEntryService.logRace` is a thin delegate and a new `RaceEntryController` is the HTTP edge. A shared `localDateInTimezone` helper in `src/common` computes `raceLocalDate`.

**Tech Stack:** NestJS v12 (ESM), Prisma 6.19.3, PostgreSQL, Vitest 5 + `vitest-mock-extended`. No new dependencies.

**Spec:** `docs/specs/2026-10-01-race-logging-flow-design.md`

## Global Constraints

- Backend only; the repo has no frontend. No new npm dependencies (all deps stay pinned exact).
- Explicit return types on every function/method (`@typescript-eslint/explicit-function-return-type: error`).
- No single-letter variable names (except `i`/`j`/`k` in indexed for loops); catch params are `error`.
- No inline `if`: always braced, body on its own line. Blank line before `if`/`for`/`while`/`return`/`throw` unless first in block.
- No nested function declarations, no `!!x`. Constructor params are `private readonly`.
- `*.service.ts` and `*.usecase.ts` never import `@prisma/client` or `src/prisma/` (`npm run lint:arch`). Only `*.db.ts` files do. Services/usecases never import Prisma enums; use local `as const` objects.
- Casts to a brand only in `*.db.ts` and `src/common` constructors (plus the HTTP-boundary pipe using the `athleteId()` constructor).
- Errors are snake_case codes (`NotFoundException('athlete_not_found')`); readable detail goes to a `Logger` line (`warn`) at the throw site in services/usecases. `src/common` helpers and the pure input parser throw only the code and never log.
- No barrel files. Relative imports carry explicit `.js` extensions.
- Postgres names are snake_case (`@@map`/`@map`); every enum has `@@map`; every `DateTime` is `@db.Timestamptz(3)` except `RaceEntry.raceLocalDate` (`@db.Date`).
- Never edit `prisma/migrations/20260929090000_init`; add a new migration. The new migration must not drop the HYR-2 hand-written CHECK or the `bid_one_leading_per_auction` partial index: hand-edit the generated SQL and verify with the README shadow-database `prisma migrate diff` check (expect `-- This is an empty migration.`).
- Tests: nested `describe` per condition ("when ..."), short `it` titles, shared setup in that `describe`'s `beforeEach`. Service/usecase specs use `Test.createTestingModule` + `mockDeep<XDb>()`; `src/common` specs are plain.
- No comments unless a non-obvious why. Delete dead code.
- Conventional commits (`type(scope): lowercase imperative`), with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Per user's workflow: stage changes and STOP for user review (`/crit`) before committing; the commit steps below are staging plus the proposed message, not an immediate commit.
- Run from `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/halifax`.

## File Structure

```
prisma/schema.prisma                                     modify: RaceDivision enum, RaceEntry.division, bibNumber nullable, Race.nameKey + unique
prisma/migrations/<ts>_add_race_entry_division_and_race_name_key/  create (generated, hand-edited)
src/common/local-date.ts (+ .spec.ts)                    create
src/common/ids.ts (+ ids.spec.ts)                        modify: RaceEntryId, athleteId()
src/athletes/athlete-id.pipe.ts (+ .spec.ts)             create
src/races/race-division.ts                               create: DIVISION const + RaceDivisionCode
src/races/race-name-key.ts (+ .spec.ts)                  create: raceNameKey(name)
src/races/usecases/log-race/log-race-input.ts (+ spec)   create: pure parser
src/races/usecases/log-race/log-race.usecase.db.ts (+ spec) create
src/races/usecases/log-race/log-race.usecase.ts (+ spec) create
src/races/race-entry.service.ts (+ spec)                 modify: logRace delegate
src/races/race-entry.controller.ts (+ spec)              create
src/races/races.module.ts                                modify
README.md                                                modify: one line on the endpoint
```

Task order is strictly sequential for one builder (each task consumes the previous task's exports); tasks 1, 2 and 3 are independent of each other if split.

---

### Task 1: `localDateInTimezone` helper

**Files:**
- Create: `src/common/local-date.ts`
- Test: `src/common/local-date.spec.ts`

**Interfaces:**
- Consumes: `IanaTimezone` from `src/common/iana-timezone.ts`.
- Produces: `localDateInTimezone(instant: Date, timezone: IanaTimezone): Date` returning the calendar date in `timezone` as a UTC-midnight `Date`.

- [ ] **Step 1: Write the failing test**

```ts
import { localDateInTimezone } from './local-date.js';
import { ianaTimezone } from './iana-timezone.js';

describe('localDateInTimezone', () => {
  const chicago = ianaTimezone('America/Chicago');
  const auckland = ianaTimezone('Pacific/Auckland');

  describe('when the UTC instant is already the next day in UTC but still the previous day locally', () => {
    it('returns the local calendar date', () => {
      const result = localDateInTimezone(new Date('2026-11-15T03:30:00Z'), chicago);

      expect(result.toISOString()).toBe('2026-11-14T00:00:00.000Z');
    });
  });

  describe('when the instant is just before local midnight', () => {
    it('stays on the local day', () => {
      const result = localDateInTimezone(new Date('2026-11-14T23:59:00-06:00'), chicago);

      expect(result.toISOString()).toBe('2026-11-14T00:00:00.000Z');
    });
  });

  describe('when the instant is just after local midnight', () => {
    it('moves to the next local day', () => {
      const result = localDateInTimezone(new Date('2026-11-15T00:01:00-06:00'), chicago);

      expect(result.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    });
  });

  describe('when the zone is ahead of UTC', () => {
    it('returns the later local date', () => {
      const result = localDateInTimezone(new Date('2026-11-14T12:30:00Z'), auckland);

      expect(result.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    });
  });

  describe('when the instant falls on a spring-forward day', () => {
    it('returns that local date', () => {
      const result = localDateInTimezone(new Date('2026-03-08T08:30:00Z'), chicago);

      expect(result.toISOString()).toBe('2026-03-08T00:00:00.000Z');
    });
  });

  describe('when the instant falls on a fall-back day', () => {
    it('returns that local date', () => {
      const result = localDateInTimezone(new Date('2026-11-01T06:30:00Z'), chicago);

      expect(result.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/common/local-date.spec.ts`
Expected: FAIL, cannot resolve `./local-date.js`.

- [ ] **Step 3: Implement**

```ts
import type { IanaTimezone } from './iana-timezone.js';

function partValue(parts: Intl.DateTimeFormatPart[], type: 'year' | 'month' | 'day'): number {
  const part = parts.find((candidate) => candidate.type === type);

  return Number(part?.value);
}

export function localDateInTimezone(instant: Date, timezone: IanaTimezone): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  return new Date(
    Date.UTC(partValue(parts, 'year'), partValue(parts, 'month') - 1, partValue(parts, 'day')),
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/common/local-date.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Stage**

```bash
git add src/common/local-date.ts src/common/local-date.spec.ts
```
Proposed message: `feat(common): add timezone-aware local date helper`

---

### Task 2: `RaceEntryId`, `athleteId()` constructor, `AthleteIdPipe`

**Files:**
- Modify: `src/common/ids.ts`
- Create: `src/common/ids.spec.ts`, `src/athletes/athlete-id.pipe.ts`, `src/athletes/athlete-id.pipe.spec.ts`

**Interfaces:**
- Produces: `RaceEntryId` brand; `athleteId(value: string): AthleteId` (trims, 1-64 chars, else throws `Error('athlete_id_invalid')`); `AthleteIdPipe` implementing `PipeTransform<string, AthleteId>` that throws `BadRequestException('athlete_id_invalid')`.

- [ ] **Step 1: Write failing tests**

`src/common/ids.spec.ts`:

```ts
import { athleteId } from './ids.js';

describe('athleteId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(athleteId('  ath_1 ')).toBe('ath_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws', () => {
      expect(() => athleteId('   ')).toThrow('athlete_id_invalid');
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws', () => {
      expect(() => athleteId('a'.repeat(65))).toThrow('athlete_id_invalid');
    });
  });
});
```

`src/athletes/athlete-id.pipe.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { AthleteIdPipe } from './athlete-id.pipe.js';

describe('AthleteIdPipe', () => {
  const pipe = new AthleteIdPipe();

  describe('when the id is valid', () => {
    it('returns the branded id', () => {
      expect(pipe.transform('ath_1')).toBe('ath_1');
    });
  });

  describe('when the id is blank', () => {
    it('throws BadRequestException', () => {
      expect(() => pipe.transform(' ')).toThrow(BadRequestException);
    });

    it('throws the athlete_id_invalid code', () => {
      expect(() => pipe.transform(' ')).toThrow('athlete_id_invalid');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/common/ids.spec.ts src/athletes/athlete-id.pipe.spec.ts`
Expected: FAIL (missing export / module).

- [ ] **Step 3: Implement**

`src/common/ids.ts` (append, keep existing lines):

```ts
export type RaceEntryId = Brand<string, 'RaceEntryId'>;

const ID_MAX_LENGTH = 64;

export function athleteId(value: string): AthleteId {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > ID_MAX_LENGTH) {
    throw new Error('athlete_id_invalid');
  }

  return trimmed as AthleteId;
}
```

`src/athletes/athlete-id.pipe.ts`:

```ts
import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { athleteId, type AthleteId } from '../common/ids.js';

@Injectable()
export class AthleteIdPipe implements PipeTransform<string, AthleteId> {
  transform(value: string): AthleteId {
    try {
      return athleteId(value);
    } catch (error) {
      if (error instanceof Error && error.message === 'athlete_id_invalid') {
        throw new BadRequestException('athlete_id_invalid');
      }

      throw error;
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/common/ids.spec.ts src/athletes/athlete-id.pipe.spec.ts`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/common/ids.ts src/common/ids.spec.ts src/athletes/athlete-id.pipe.ts src/athletes/athlete-id.pipe.spec.ts
```
Proposed message: `feat(common): add athlete id constructor and path pipe`

---

### Task 3: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_race_entry_division_and_race_name_key/migration.sql` (generated, then hand-edited)

**Interfaces:**
- Produces: Prisma enum `RaceDivision`; `RaceEntry.division: RaceDivision` (required); `RaceEntry.bibNumber: string | null`; `Race.nameKey: string` (required); compound unique accessor `nameKey_date_timezone` on `Race`.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Add after the `RaceEntryVerificationStatus` enum:

```prisma
enum RaceDivision {
  SINGLE_OPEN_MEN
  SINGLE_OPEN_WOMEN
  SINGLE_PRO_MEN
  SINGLE_PRO_WOMEN
  DOUBLES_OPEN_MEN
  DOUBLES_OPEN_WOMEN
  DOUBLES_OPEN_MIXED
  DOUBLES_PRO_MEN
  DOUBLES_PRO_WOMEN
  RELAY_MEN
  RELAY_WOMEN
  RELAY_MIXED

  @@map("race_division")
}
```

In `model RaceEntry`: change `bibNumber String @map("bib_number")` to `bibNumber String? @map("bib_number")` and add `division RaceDivision` after `raceId` (keep column alignment).

In `model Race`: add `nameKey String @map("name_key")` after `name`, and add `@@unique([nameKey, date, timezone])` above `@@map("races")`. (The start-instant column stays named `date`.)

- [ ] **Step 2: Generate the migration without applying it**

Run: `docker compose up -d postgres && npx prisma migrate dev --name add_race_entry_division_and_race_name_key --create-only`
Expected: new folder `prisma/migrations/<ts>_add_race_entry_division_and_race_name_key` with an unapplied `migration.sql`.

- [ ] **Step 3: Hand-edit the generated SQL (required)**

Open `migration.sql` and make it satisfy all of these:

1. Strip every `DROP` of HYR-2 hand-written objects. Prisma does not know about the partial unique index `bid_one_leading_per_auction` or the `floor_price_cents >= 1000` CHECK and will try to drop them. Delete any `DROP INDEX "bid_one_leading_per_auction"` and any `DROP CONSTRAINT` of the floor-price CHECK. Then run `grep -n "DROP" migration.sql`; the only acceptable hit is `ALTER COLUMN "bib_number" DROP NOT NULL`.
2. Backfill `name_key` instead of the generated `ADD COLUMN "name_key" TEXT NOT NULL` (which fails if `races` has rows). Replace it with this sequence, placed before the unique index creation:

```sql
ALTER TABLE "races" ADD COLUMN "name_key" TEXT;
UPDATE "races" SET "name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'));
ALTER TABLE "races" ALTER COLUMN "name_key" SET NOT NULL;
```

   The expression must stay equal to `raceNameKey()` (trim, collapse whitespace, lowercase). If the later `CREATE UNIQUE INDEX` fails on existing rows because backfilled keys collide, stop and report; do not delete data.
3. Confirm it still contains `CREATE TYPE "race_division"`, `ALTER TABLE "race_entries" ADD COLUMN "division" "race_division" NOT NULL`, `ALTER COLUMN "bib_number" DROP NOT NULL`, and `CREATE UNIQUE INDEX "races_name_key_date_timezone_key" ON "races"("name_key", "date", "timezone")`. `division` is NOT NULL without default; safe only because no code created `race_entries` rows before this ticket. If the dev DB has rows, truncate `race_entries` first.

- [ ] **Step 4: Apply, verify, generate client**

Run: `npx prisma migrate dev` (applies the edited migration), then `npx prisma generate && npm run build`.
Then run the README shadow-database check verbatim (create `shadow_check`, `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url ... --script`, drop `shadow_check`).
Expected: `-- This is an empty migration.` Any `DROP` in the output is a failure to fix before moving on.
Also confirm in psql that both hand-written objects survived: `\d bids` shows `bid_one_leading_per_auction`; `\d zone_floor_prices` shows the `>= 1000` CHECK.

- [ ] **Step 5: Stage**

```bash
git add prisma/schema.prisma prisma/migrations
```
Proposed message: `feat(db): add race division, nullable bib and race name key`

---

### Task 4: Division constant and pure input parser

**Files:**
- Create: `src/races/race-division.ts`, `src/races/race-name-key.ts`, `src/races/usecases/log-race/log-race-input.ts`
- Test: `src/races/race-name-key.spec.ts`, `src/races/usecases/log-race/log-race-input.spec.ts`

**Interfaces:**
- Consumes: `ianaTimezone`, `IanaTimezone` (`src/common/iana-timezone.ts`).
- Produces: `raceNameKey(name: string): string` (trim, collapse whitespace, lowercase); `DIVISION` const, `RaceDivisionCode` type; `LogRaceInput { name: string; date: Date; timezone: IanaTimezone; location: string; division: RaceDivisionCode }`; `parseLogRaceInput(raw: unknown, now: Date): LogRaceInput` throwing `BadRequestException` with codes `body_invalid`, `race_name_invalid`, `race_date_invalid`, `race_date_out_of_range`, `timezone_invalid`, `race_location_invalid`, `division_invalid` (checked in that order).

- [ ] **Step 1: Write the failing tests**

`src/races/race-name-key.spec.ts`:

```ts
import { raceNameKey } from './race-name-key.js';

describe('raceNameKey', () => {
  describe('when the name has mixed case', () => {
    it('lowercases it', () => {
      expect(raceNameKey('Hyrox CHICAGO')).toBe('hyrox chicago');
    });
  });

  describe('when the name has surrounding whitespace', () => {
    it('trims it', () => {
      expect(raceNameKey('  Hyrox Chicago  ')).toBe('hyrox chicago');
    });
  });

  describe('when the name has repeated inner whitespace', () => {
    it('collapses it to single spaces', () => {
      expect(raceNameKey('Hyrox \t  Chicago')).toBe('hyrox chicago');
    });
  });

  describe('when two names differ only by case and spacing', () => {
    it('produces the same key', () => {
      expect(raceNameKey(' HYROX  chicago')).toBe(raceNameKey('hyrox Chicago '));
    });
  });
});
```

`src/races/usecases/log-race/log-race-input.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { raceNameKey } from '../../race-name-key.js';
import { parseLogRaceInput } from './log-race-input.js';

describe('parseLogRaceInput', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const valid = {
    name: 'Hyrox Chicago',
    date: '2026-11-14T09:00:00-06:00',
    timezone: 'America/Chicago',
    location: 'Chicago, IL',
    division: 'SINGLE_OPEN_MEN',
  };

  function codeFor(body: unknown): string {
    try {
      parseLogRaceInput(body, now);
    } catch (error) {
      if (error instanceof BadRequestException) {
        return error.message;
      }

      throw error;
    }

    return 'no_error';
  }

  describe('when the body is valid', () => {
    it('returns the parsed input', () => {
      const result = parseLogRaceInput(valid, now);

      expect(result).toEqual({
        name: 'Hyrox Chicago',
        date: new Date('2026-11-14T15:00:00Z'),
        timezone: 'America/Chicago',
        location: 'Chicago, IL',
        division: 'SINGLE_OPEN_MEN',
      });
    });
  });

  describe('when the body is not an object', () => {
    it('throws body_invalid', () => {
      expect(codeFor(null)).toBe('body_invalid');
      expect(codeFor('x')).toBe('body_invalid');
    });
  });

  describe('when the name has surrounding or repeated whitespace', () => {
    it('trims and collapses it', () => {
      const result = parseLogRaceInput({ ...valid, name: '  Hyrox   Chicago ' }, now);

      expect(result.name).toBe('Hyrox Chicago');
    });
  });

  describe('when the name is blank, missing, not a string or over 120 characters', () => {
    it('throws race_name_invalid', () => {
      expect(codeFor({ ...valid, name: '  ' })).toBe('race_name_invalid');
      expect(codeFor({ ...valid, name: undefined })).toBe('race_name_invalid');
      expect(codeFor({ ...valid, name: 5 })).toBe('race_name_invalid');
      expect(codeFor({ ...valid, name: 'a'.repeat(121) })).toBe('race_name_invalid');
    });
  });

  describe('when the date is not an ISO datetime with an offset', () => {
    it('throws race_date_invalid', () => {
      expect(codeFor({ ...valid, date: '2026-11-14' })).toBe('race_date_invalid');
      expect(codeFor({ ...valid, date: '2026-11-14T09:00:00' })).toBe('race_date_invalid');
      expect(codeFor({ ...valid, date: '2026-13-40T09:00:00Z' })).toBe('race_date_invalid');
      expect(codeFor({ ...valid, date: 123 })).toBe('race_date_invalid');
    });
  });

  describe('when the date is before 2017-01-01', () => {
    it('throws race_date_out_of_range', () => {
      expect(codeFor({ ...valid, date: '2016-12-31T09:00:00Z' })).toBe('race_date_out_of_range');
    });
  });

  describe('when the date is more than two years ahead', () => {
    it('throws race_date_out_of_range', () => {
      expect(codeFor({ ...valid, date: '2028-10-02T09:00:00Z' })).toBe('race_date_out_of_range');
    });
  });

  describe('when the date is in the past but after 2017', () => {
    it('accepts it', () => {
      expect(codeFor({ ...valid, date: '2024-05-04T09:00:00Z' })).toBe('no_error');
    });
  });

  describe('when the timezone is not an IANA id', () => {
    it('throws timezone_invalid', () => {
      expect(codeFor({ ...valid, timezone: 'Mars/Base' })).toBe('timezone_invalid');
      expect(codeFor({ ...valid, timezone: 7 })).toBe('timezone_invalid');
    });
  });

  describe('when the location is blank, missing or over 120 characters', () => {
    it('throws race_location_invalid', () => {
      expect(codeFor({ ...valid, location: '' })).toBe('race_location_invalid');
      expect(codeFor({ ...valid, location: undefined })).toBe('race_location_invalid');
      expect(codeFor({ ...valid, location: 'a'.repeat(121) })).toBe('race_location_invalid');
    });
  });

  describe('when the division is not in the enum', () => {
    it('throws division_invalid', () => {
      expect(codeFor({ ...valid, division: 'OPEN' })).toBe('division_invalid');
      expect(codeFor({ ...valid, division: undefined })).toBe('division_invalid');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/races/race-name-key.spec.ts src/races/usecases/log-race/log-race-input.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/races/race-division.ts`:

```ts
export const DIVISION = {
  SINGLE_OPEN_MEN: 'SINGLE_OPEN_MEN',
  SINGLE_OPEN_WOMEN: 'SINGLE_OPEN_WOMEN',
  SINGLE_PRO_MEN: 'SINGLE_PRO_MEN',
  SINGLE_PRO_WOMEN: 'SINGLE_PRO_WOMEN',
  DOUBLES_OPEN_MEN: 'DOUBLES_OPEN_MEN',
  DOUBLES_OPEN_WOMEN: 'DOUBLES_OPEN_WOMEN',
  DOUBLES_OPEN_MIXED: 'DOUBLES_OPEN_MIXED',
  DOUBLES_PRO_MEN: 'DOUBLES_PRO_MEN',
  DOUBLES_PRO_WOMEN: 'DOUBLES_PRO_WOMEN',
  RELAY_MEN: 'RELAY_MEN',
  RELAY_WOMEN: 'RELAY_WOMEN',
  RELAY_MIXED: 'RELAY_MIXED',
} as const;

export type RaceDivisionCode = (typeof DIVISION)[keyof typeof DIVISION];

export function isRaceDivisionCode(value: unknown): value is RaceDivisionCode {
  return typeof value === 'string' && Object.hasOwn(DIVISION, value);
}
```

`src/races/race-name-key.ts`:

```ts
export function raceNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
```

The SQL backfill in Task 3 (`lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))`) must stay equivalent to this function.

`src/races/usecases/log-race/log-race-input.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { ianaTimezone, type IanaTimezone } from '../../../common/iana-timezone.js';
import { isRaceDivisionCode, type RaceDivisionCode } from '../../race-division.js';

export interface LogRaceInput {
  name: string;
  date: Date;
  timezone: IanaTimezone;
  location: string;
  division: RaceDivisionCode;
}

const TEXT_MAX_LENGTH = 120;
const MIN_RACE_DATE = new Date('2017-01-01T00:00:00Z');
const MAX_YEARS_AHEAD = 2;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseText(value: unknown, code: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(code);
  }

  const collapsed = value.trim().replace(/\s+/g, ' ');

  if (collapsed.length === 0 || collapsed.length > TEXT_MAX_LENGTH) {
    throw new BadRequestException(code);
  }

  return collapsed;
}

function parseDate(value: unknown, now: Date): Date {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value)) {
    throw new BadRequestException('race_date_invalid');
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('race_date_invalid');
  }

  const latest = new Date(now);

  latest.setUTCFullYear(latest.getUTCFullYear() + MAX_YEARS_AHEAD);

  if (date < MIN_RACE_DATE || date > latest) {
    throw new BadRequestException('race_date_out_of_range');
  }

  return date;
}

function parseTimezone(value: unknown): IanaTimezone {
  if (typeof value !== 'string') {
    throw new BadRequestException('timezone_invalid');
  }

  try {
    return ianaTimezone(value);
  } catch {
    throw new BadRequestException('timezone_invalid');
  }
}

export function parseLogRaceInput(raw: unknown, now: Date): LogRaceInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadRequestException('body_invalid');
  }

  const body = raw as Record<string, unknown>;
  const name = parseText(body.name, 'race_name_invalid');
  const date = parseDate(body.date, now);
  const timezone = parseTimezone(body.timezone);
  const location = parseText(body.location, 'race_location_invalid');

  if (!isRaceDivisionCode(body.division)) {
    throw new BadRequestException('division_invalid');
  }

  return { name, date, timezone, location, division: body.division };
}
```

Note: `catch {}` without a binding avoids the single-letter/naming issue; `ISO_WITH_OFFSET` rejects JS-accepted loose strings. `'2026-13-40T09:00:00Z'` matches the regex but `new Date` yields NaN, covered.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/races/race-name-key.spec.ts src/races/usecases/log-race/log-race-input.spec.ts`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/races/race-division.ts src/races/race-name-key.ts src/races/race-name-key.spec.ts src/races/usecases/log-race/log-race-input.ts src/races/usecases/log-race/log-race-input.spec.ts
```
Proposed message: `feat(races): parse and validate race log input`

---

### Task 5: Usecase db

**Files:**
- Create: `src/races/usecases/log-race/log-race.usecase.db.ts`
- Test: `src/races/usecases/log-race/log-race.usecase.db.spec.ts` (deviation from the repo's "db files untested" habit, because this db holds the race-reuse and conflict-mapping logic the spec requires tests for; Prisma is mocked, no real database)

**Interfaces:**
- Consumes: `PrismaService`, `AthleteId`, `IanaTimezone`, `RaceDivisionCode` (assignable to the Prisma enum string union).
- Produces:

```ts
interface AthleteStanding { id: string; isBanned: boolean }
interface CreateEntryParams {
  athleteId: AthleteId;
  race: { name: string; nameKey: string; date: Date; timezone: IanaTimezone; location: string };
  division: RaceDivisionCode;
  raceLocalDate: Date;
}
class LogRaceUsecaseDb {
  findAthleteStanding(id: AthleteId): Promise<AthleteStanding | null>;
  createEntry(params: CreateEntryParams): Promise<RaceEntryWithRace | null>; // null only on the (athlete, local date) conflict
}
export type RaceEntryWithRace = Prisma.RaceEntryGetPayload<{ include: { race: true } }>;
```

- [ ] **Step 1: Write the failing test**

```ts
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { LogRaceUsecaseDb, type CreateEntryParams } from './log-race.usecase.db.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { AthleteId } from '../../../common/ids.js';
import type { IanaTimezone } from '../../../common/iana-timezone.js';

describe('LogRaceUsecaseDb', () => {
  const params: CreateEntryParams = {
    athleteId: 'athlete-1' as AthleteId,
    race: {
      name: 'Hyrox Chicago',
      nameKey: 'hyrox chicago',
      date: new Date('2026-11-14T15:00:00Z'),
      timezone: 'America/Chicago' as IanaTimezone,
      location: 'Chicago, IL',
    },
    division: 'SINGLE_OPEN_MEN',
    raceLocalDate: new Date('2026-11-14T00:00:00Z'),
  };
  const raceKey = {
    nameKey_date_timezone: {
      nameKey: 'hyrox chicago',
      date: params.race.date,
      timezone: 'America/Chicago',
    },
  };
  const race = { id: 'race-1' };
  const entry = { id: 'entry-1', race };
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<PrismaService>;
  let db: LogRaceUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(((callback: (client: unknown) => unknown) => callback(tx)) as never);
    tx.raceEntry.create.mockResolvedValue(entry as never);
    db = new LogRaceUsecaseDb(prisma);
  });

  describe('when the race already exists', () => {
    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(race as never);
    });

    it('reuses it without inserting', async () => {
      await db.createEntry(params);

      expect(tx.race.createMany).not.toHaveBeenCalled();
      expect(tx.raceEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ raceId: 'race-1' }) }),
      );
    });

    it('looks the race up by its unique key', async () => {
      await db.createEntry(params);

      expect(tx.race.findUnique).toHaveBeenCalledWith({ where: raceKey });
    });

    it('returns the created entry', async () => {
      const result = await db.createEntry(params);

      expect(result).toBe(entry);
    });
  });

  describe('when the race does not exist', () => {
    beforeEach(() => {
      tx.race.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(race as never);
      tx.race.createMany.mockResolvedValue({ count: 1 });
    });

    it('inserts it skipping duplicates, then re-finds it', async () => {
      await db.createEntry(params);

      expect(tx.race.createMany).toHaveBeenCalledWith({
        data: [
          {
            name: 'Hyrox Chicago',
            nameKey: 'hyrox chicago',
            date: params.race.date,
            timezone: 'America/Chicago',
            location: 'Chicago, IL',
          },
        ],
        skipDuplicates: true,
      });
      expect(tx.race.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('when another writer inserts the same race concurrently', () => {
    beforeEach(() => {
      tx.race.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'race-other' } as never);
      tx.race.createMany.mockResolvedValue({ count: 0 });
    });

    it('reuses the other writer row without erroring', async () => {
      await db.createEntry(params);

      expect(tx.raceEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ raceId: 'race-other' }) }),
      );
    });
  });

  describe('when the entry insert violates the athlete and local date index', () => {
    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(race as never);
      tx.raceEntry.create.mockRejectedValue({ code: 'P2002', meta: { target: ['athlete_id', 'race_local_date'] } });
    });

    it('returns null', async () => {
      const result = await db.createEntry(params);

      expect(result).toBeNull();
    });
  });

  describe('when a unique violation names a different target', () => {
    const failure = { code: 'P2002', meta: { target: ['name_key', 'date', 'timezone'] } };

    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(race as never);
      tx.raceEntry.create.mockRejectedValue(failure);
    });

    it('rethrows it', async () => {
      await expect(db.createEntry(params)).rejects.toBe(failure);
    });
  });

  describe('when the entry insert fails for any other reason', () => {
    const failure = new Error('boom');

    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(race as never);
      tx.raceEntry.create.mockRejectedValue(failure);
    });

    it('rethrows it', async () => {
      await expect(db.createEntry(params)).rejects.toBe(failure);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/races/usecases/log-race/log-race.usecase.db.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AthleteId } from '../../../common/ids.js';
import type { IanaTimezone } from '../../../common/iana-timezone.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { RaceDivisionCode } from '../../race-division.js';

export type RaceEntryWithRace = Prisma.RaceEntryGetPayload<{ include: { race: true } }>;

export interface AthleteStanding {
  id: string;
  isBanned: boolean;
}

export interface CreateEntryParams {
  athleteId: AthleteId;
  race: { name: string; nameKey: string; date: Date; timezone: IanaTimezone; location: string };
  division: RaceDivisionCode;
  raceLocalDate: Date;
}

const UNIQUE_VIOLATION = 'P2002';
const ENTRY_DATE_TARGET = /race_?local_?date/i;

function isEntryDateConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== UNIQUE_VIOLATION) {
    return false;
  }

  const meta = 'meta' in error ? (error.meta as { target?: unknown } | undefined) : undefined;

  return ENTRY_DATE_TARGET.test(String(meta?.target));
}

@Injectable()
export class LogRaceUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  findAthleteStanding(id: AthleteId): Promise<AthleteStanding | null> {
    return this.prisma.athlete.findUnique({
      where: { id },
      select: { id: true, isBanned: true },
    });
  }

  async createEntry(params: CreateEntryParams): Promise<RaceEntryWithRace | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const where = {
          nameKey_date_timezone: {
            nameKey: params.race.nameKey,
            date: params.race.date,
            timezone: params.race.timezone,
          },
        };
        let race = await tx.race.findUnique({ where });

        if (!race) {
          await tx.race.createMany({ data: [params.race], skipDuplicates: true });
          race = await tx.race.findUniqueOrThrow({ where });
        }

        return tx.raceEntry.create({
          data: {
            athleteId: params.athleteId,
            raceId: race.id,
            division: params.division,
            raceDate: params.race.date,
            raceLocalDate: params.raceLocalDate,
          },
          include: { race: true },
        });
      });
    } catch (error) {
      if (isEntryDateConflict(error)) {
        return null;
      }

      throw error;
    }
  }
}
```

Notes for the implementer:
- The first spec test mocks `findUnique` for the second lookup; since the implementation calls `findUniqueOrThrow` for the re-find, change the spec's `tx.race.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(...)` setups to `tx.race.findUnique.mockResolvedValue(null)` plus `tx.race.findUniqueOrThrow.mockResolvedValue(race as never)` (and `{ id: 'race-other' }` in the concurrent case), and assert `findUniqueOrThrow` was called with `{ where: raceKey }` instead of `findUnique` being called twice. Keep assertions otherwise as written.
- `createMany` with `skipDuplicates` compiles to `INSERT ... ON CONFLICT DO NOTHING`; unlike catching `P2002` from `create`, a conflict does not abort the Postgres transaction, so the re-find and the entry insert still run. A rolled-back transaction (entry conflict) also removes a `Race` created in the same call, so no orphan.
- `meta.target` for Postgres unique violations is an array of column names (or the index name). If the smoke test in Task 8 shows a different shape, adjust `ENTRY_DATE_TARGET` only; the point is to match the race-entries index and nothing else.
- `import type { Prisma }` keeps the file's Prisma use type-only; `dependency-cruiser` allows `@prisma/client` in `*.db.ts` regardless.

- [ ] **Step 4: Run to verify pass, then gates**

Run: `npx vitest run src/races/usecases/log-race/log-race.usecase.db.spec.ts && npm run build && npm run lint && npm run lint:arch`
Expected: PASS; lint:arch must NOT flag this file (it ends in `.usecase.db.ts`, not `.usecase.ts`).

- [ ] **Step 5: Stage**

```bash
git add src/races/usecases/log-race/log-race.usecase.db.ts src/races/usecases/log-race/log-race.usecase.db.spec.ts
```
Proposed message: `feat(races): add log race usecase db`

---

### Task 6: Usecase

**Files:**
- Create: `src/races/usecases/log-race/log-race.usecase.ts`
- Test: `src/races/usecases/log-race/log-race.usecase.spec.ts`

**Interfaces:**
- Consumes: `LogRaceUsecaseDb` (Task 5), `parseLogRaceInput` and `raceNameKey` (Task 4), `localDateInTimezone` (Task 1), `AthleteId`.
- Produces: `LogRaceUsecase.execute(athleteId: AthleteId, rawInput: unknown, now?: Date): Promise<LogRaceResult>`; `type LogRaceResult = RaceEntryWithRace`. Throws `NotFoundException('athlete_not_found')`, `ForbiddenException('athlete_banned')`, `ConflictException('race_entry_date_conflict')`, plus parser `BadRequestException`s.

- [ ] **Step 1: Write the failing test**

```ts
import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { LogRaceUsecase } from './log-race.usecase.js';
import { LogRaceUsecaseDb } from './log-race.usecase.db.js';
import type { AthleteId } from '../../../common/ids.js';

describe('LogRaceUsecase', () => {
  const athleteId = 'athlete-1' as AthleteId;
  const now = new Date('2026-10-01T12:00:00Z');
  const body = {
    name: 'Hyrox Chicago',
    date: '2026-11-15T03:30:00Z',
    timezone: 'America/Chicago',
    location: 'Chicago, IL',
    division: 'SINGLE_OPEN_MEN',
  };
  let db: DeepMockProxy<LogRaceUsecaseDb>;
  let usecase: LogRaceUsecase;
  let warn: MockInstance;

  beforeEach(async () => {
    db = mockDeep<LogRaceUsecaseDb>();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [LogRaceUsecase, { provide: LogRaceUsecaseDb, useValue: db }],
    }).compile();
    usecase = moduleRef.get(LogRaceUsecase);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the input is invalid', () => {
    it('rejects before touching the db', async () => {
      await expect(usecase.execute(athleteId, { ...body, division: 'x' }, now)).rejects.toThrow('division_invalid');
      expect(db.findAthleteStanding).not.toHaveBeenCalled();
    });
  });

  describe('when the athlete does not exist', () => {
    beforeEach(() => {
      db.findAthleteStanding.mockResolvedValue(null);
    });

    it('throws NotFoundException with athlete_not_found', async () => {
      const result = usecase.execute(athleteId, body, now);

      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('athlete_not_found');
    });

    it('logs the athlete id', async () => {
      await usecase.execute(athleteId, body, now).catch(() => undefined);

      expect(warn).toHaveBeenCalledWith('Athlete athlete-1 not found');
    });
  });

  describe('when the athlete is banned', () => {
    beforeEach(() => {
      db.findAthleteStanding.mockResolvedValue({ id: 'athlete-1', isBanned: true });
    });

    it('throws ForbiddenException with athlete_banned', async () => {
      const result = usecase.execute(athleteId, body, now);

      await expect(result).rejects.toThrow(ForbiddenException);
      await expect(result).rejects.toThrow('athlete_banned');
    });

    it('does not write', async () => {
      await usecase.execute(athleteId, body, now).catch(() => undefined);

      expect(db.createEntry).not.toHaveBeenCalled();
    });
  });

  describe('when the athlete is in good standing', () => {
    const entry = { id: 'entry-1' };

    beforeEach(() => {
      db.findAthleteStanding.mockResolvedValue({ id: 'athlete-1', isBanned: false });
      db.createEntry.mockResolvedValue(entry as never);
    });

    it('returns the created entry', async () => {
      const result = await usecase.execute(athleteId, body, now);

      expect(result).toBe(entry);
    });

    it('writes the parsed race with its normalized name key and the local calendar date', async () => {
      await usecase.execute(athleteId, body, now);

      expect(db.createEntry).toHaveBeenCalledWith({
        athleteId,
        race: {
          name: 'Hyrox Chicago',
          nameKey: 'hyrox chicago',
          date: new Date('2026-11-15T03:30:00Z'),
          timezone: 'America/Chicago',
          location: 'Chicago, IL',
        },
        division: 'SINGLE_OPEN_MEN',
        raceLocalDate: new Date('2026-11-14T00:00:00Z'),
      });
    });
  });

  describe('when the athlete already has an entry on that local date', () => {
    beforeEach(() => {
      db.findAthleteStanding.mockResolvedValue({ id: 'athlete-1', isBanned: false });
      db.createEntry.mockResolvedValue(null);
    });

    it('throws ConflictException with race_entry_date_conflict', async () => {
      const result = usecase.execute(athleteId, body, now);

      await expect(result).rejects.toThrow(ConflictException);
      await expect(result).rejects.toThrow('race_entry_date_conflict');
    });

    it('logs the athlete id and local date', async () => {
      await usecase.execute(athleteId, body, now).catch(() => undefined);

      expect(warn).toHaveBeenCalledWith(
        'Athlete athlete-1 already has a race entry on 2026-11-14',
      );
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/races/usecases/log-race/log-race.usecase.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AthleteId } from '../../../common/ids.js';
import { localDateInTimezone } from '../../../common/local-date.js';
import { parseLogRaceInput } from './log-race-input.js';
import { LogRaceUsecaseDb, type RaceEntryWithRace } from './log-race.usecase.db.js';

export type LogRaceResult = RaceEntryWithRace;

@Injectable()
export class LogRaceUsecase {
  private readonly logger = new Logger(LogRaceUsecase.name);

  constructor(private readonly db: LogRaceUsecaseDb) {}

  async execute(athleteId: AthleteId, rawInput: unknown, now: Date = new Date()): Promise<LogRaceResult> {
    const input = parseLogRaceInput(rawInput, now);
    const athlete = await this.db.findAthleteStanding(athleteId);

    if (!athlete) {
      this.logger.warn(`Athlete ${athleteId} not found`);

      throw new NotFoundException('athlete_not_found');
    }

    if (athlete.isBanned) {
      this.logger.warn(`Athlete ${athleteId} is banned and cannot log a race`);

      throw new ForbiddenException('athlete_banned');
    }

    const raceLocalDate = localDateInTimezone(input.date, input.timezone);
    const entry = await this.db.createEntry({
      athleteId,
      race: {
        name: input.name,
        nameKey: raceNameKey(input.name),
        date: input.date,
        timezone: input.timezone,
        location: input.location,
      },
      division: input.division,
      raceLocalDate,
    });

    if (!entry) {
      this.logger.warn(
        `Athlete ${athleteId} already has a race entry on ${raceLocalDate.toISOString().slice(0, 10)}`,
      );

      throw new ConflictException('race_entry_date_conflict');
    }

    return entry;
  }
}
```

Note: `import { ..., type RaceEntryWithRace }` of a type from a `*.usecase.db.ts` is fine for lint:arch (it checks for `@prisma/client`/`src/prisma` imports; the `import type { Prisma }` in the db file is not followed transitively as a forbidden edge because rules match direct dependencies only). If `lint:arch` reports it, move `RaceEntryWithRace` re-declaration to the usecase via `Awaited<ReturnType<...>>` like `RaceService` does (`NonNullable<Awaited<ReturnType<LogRaceUsecaseDb['createEntry']>>>`).

- [ ] **Step 4: Run to verify pass, then arch lint**

Run: `npx vitest run src/races/usecases/log-race && npm run lint:arch`
Expected: PASS, no violations.

- [ ] **Step 5: Stage**

```bash
git add src/races/usecases/log-race/log-race.usecase.ts src/races/usecases/log-race/log-race.usecase.spec.ts
```
Proposed message: `feat(races): add log race usecase`

---

### Task 7: Service delegate, controller, module wiring

**Files:**
- Modify: `src/races/race-entry.service.ts`, `src/races/race-entry.service.spec.ts`, `src/races/races.module.ts`
- Create: `src/races/race-entry.controller.ts`, `src/races/race-entry.controller.spec.ts`

**Interfaces:**
- Consumes: `LogRaceUsecase.execute`, `LogRaceResult`, `AthleteIdPipe`, `AthleteId`.
- Produces: `RaceEntryService.logRace(athleteId: AthleteId, body: unknown): Promise<LogRaceResult>`; `RaceEntryController.logRace(athleteId, body)` at `POST /athletes/:athleteId/race-entries` (201).

- [ ] **Step 1: Write failing tests**

In `race-entry.service.spec.ts`: add imports `LogRaceUsecase` from `./usecases/log-race/log-race.usecase.js`; add `let logRace: DeepMockProxy<LogRaceUsecase>;`; in `beforeEach` set `logRace = mockDeep<LogRaceUsecase>();` and add `{ provide: LogRaceUsecase, useValue: logRace }` to providers. Append inside the top `describe`:

```ts
  describe('logRace', () => {
    describe('when called', () => {
      const entry = { id: 'entry-1' };
      const body = { name: 'Hyrox Chicago' };

      beforeEach(() => {
        logRace.execute.mockResolvedValue(entry as never);
      });

      it('delegates to the usecase and returns its result', async () => {
        const result = await service.logRace('athlete-1' as AthleteId, body);

        expect(logRace.execute).toHaveBeenCalledWith('athlete-1', body);
        expect(result).toBe(entry);
      });
    });
  });
```

`src/races/race-entry.controller.spec.ts`:

```ts
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { RaceEntryController } from './race-entry.controller.js';
import { RaceEntryService } from './race-entry.service.js';
import type { AthleteId } from '../common/ids.js';

describe('RaceEntryController', () => {
  let service: DeepMockProxy<RaceEntryService>;
  let controller: RaceEntryController;

  beforeEach(() => {
    service = mockDeep<RaceEntryService>();
    controller = new RaceEntryController(service);
  });

  describe('logRace', () => {
    const entry = { id: 'entry-1' };
    const body = { name: 'Hyrox Chicago' };

    beforeEach(() => {
      service.logRace.mockResolvedValue(entry as never);
    });

    it('passes the athlete id and body to the service', async () => {
      const result = await controller.logRace('athlete-1' as AthleteId, body);

      expect(service.logRace).toHaveBeenCalledWith('athlete-1', body);
      expect(result).toBe(entry);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/races`
Expected: FAIL (logRace missing / controller missing / service spec providers).

- [ ] **Step 3: Implement**

`race-entry.service.ts`: add imports and change constructor/methods:

```ts
import { LogRaceUsecase, type LogRaceResult } from './usecases/log-race/log-race.usecase.js';
// ...
  constructor(
    private readonly db: RaceEntryDb,
    private readonly logRaceUsecase: LogRaceUsecase,
  ) {}

  logRace(athleteId: AthleteId, body: unknown): Promise<LogRaceResult> {
    return this.logRaceUsecase.execute(athleteId, body);
  }
```

`race-entry.controller.ts`:

```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { AthleteIdPipe } from '../athletes/athlete-id.pipe.js';
import type { AthleteId } from '../common/ids.js';
import { RaceEntryService } from './race-entry.service.js';
import type { LogRaceResult } from './usecases/log-race/log-race.usecase.js';

@Controller('athletes/:athleteId/race-entries')
export class RaceEntryController {
  constructor(private readonly service: RaceEntryService) {}

  @Post()
  logRace(@Param('athleteId', AthleteIdPipe) athleteId: AthleteId, @Body() body: unknown): Promise<LogRaceResult> {
    return this.service.logRace(athleteId, body);
  }
}
```

`races.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RaceDb } from './race.db.js';
import { RaceService } from './race.service.js';
import { RaceEntryController } from './race-entry.controller.js';
import { RaceEntryDb } from './race-entry.db.js';
import { RaceEntryService } from './race-entry.service.js';
import { LogRaceUsecase } from './usecases/log-race/log-race.usecase.js';
import { LogRaceUsecaseDb } from './usecases/log-race/log-race.usecase.db.js';

@Module({
  controllers: [RaceEntryController],
  providers: [RaceService, RaceDb, RaceEntryService, RaceEntryDb, LogRaceUsecase, LogRaceUsecaseDb],
  exports: [RaceService, RaceEntryService],
})
export class RacesModule {}
```

If `tsc` raises TS1272 (type-only import in a decorated signature), switch the `AthleteId` and `LogRaceResult` imports in the controller to plain value-position imports.

- [ ] **Step 4: Run all gates**

Run: `npm run build && npm run lint && npm run lint:arch && npm test`
Expected: all pass.

- [ ] **Step 5: Stage**

```bash
git add src/races
```
Proposed message: `feat(races): add race logging endpoint`

---

### Task 8: Smoke test and docs

**Files:**
- Modify: `README.md` (add a short "API" bullet: `POST /athletes/:athleteId/race-entries`, body fields, error codes; note athlete id in path is a temporary stand-in until HYR-3)

- [ ] **Step 1: Boot against local Postgres**

Run: `docker compose up -d postgres && npx prisma migrate deploy && npm run build && (PORT=3100 node dist/main.js &)`
Seed an athlete (no create flow exists yet): `docker compose exec postgres psql -U hyrox -d hyrox_sponsor -c "INSERT INTO athletes (id, name, email, updated_at) VALUES ('ath_smoke','Smoke','smoke@example.com', now())"`

- [ ] **Step 2: Exercise the endpoint** (also confirm the `meta.target` shape matches `ENTRY_DATE_TARGET` in the usecase db: the duplicate request must return 409, not 500)

```bash
curl -s -i -X POST localhost:3100/athletes/ath_smoke/race-entries -H 'content-type: application/json' \
  -d '{"name":"Hyrox Chicago","date":"2026-11-14T09:00:00-06:00","timezone":"America/Chicago","location":"Chicago, IL","division":"SINGLE_OPEN_MEN"}'
```
Expected: `201`, body has `verificationStatus: "PENDING"`, `bibNumber: null`, `raceLocalDate: "2026-11-14T00:00:00.000Z"`, nested `race`.

Repeat the same request: expect `409` `race_entry_date_conflict`, and `SELECT count(*) FROM races` still 1 (no orphan race).
Use another athlete id: `404` `athlete_not_found`. Bad division: `400` `division_invalid`.
Second athlete (insert one more row) logging "  HYROX  chicago " with the same date/timezone: `201`, `SELECT count(*) FROM races` still 1 (race reused via `name_key`).

- [ ] **Step 3: Clean up**

Stop the node process; delete smoke rows (`DELETE FROM race_entries; DELETE FROM races; DELETE FROM athletes WHERE id LIKE 'ath_smoke%'`).

- [ ] **Step 4: Stage and stop for review**

```bash
git add README.md
```
Proposed message: `docs: document race logging endpoint`
Tell the user everything is staged and they can run `/crit` before committing. Do not commit.

---

## Self-Review

- Spec coverage: schema gaps (Task 3), API shape and every error code (Tasks 2, 4, 6), division enum (3, 4), local-date helper (1), usecase/db split and conflict-without-orphan-race (5, 6), controller and module (7), smoke (8), README (8). Out-of-scope items have no tasks.
- Type consistency: `RaceDivisionCode`, `LogRaceInput`, `CreateEntryParams`, `RaceEntryWithRace`, `LogRaceResult`, `athleteId()`/`AthleteIdPipe` names match across tasks.
- Race reuse (user-directed): Task 3 (nameKey column, unique, backfill, strip DROPs, shadow diff), Task 4 (`raceNameKey` + spec), Task 5 (insert-or-reuse, concurrent-insert and conflict-target tests), Task 6 (nameKey passed to db). The "possible duplicate Race rows" caveat is gone from spec section 6 and judgment call 6.
- Known risk to verify during Task 3/5: `RaceDivisionCode` string union must be assignable to the generated Prisma `RaceDivision` type (it is, same literals). `createMany({ skipDuplicates: true })` requires Postgres (it is).
