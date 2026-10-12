# HYR-8: Auction Scheduling Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recurring in-process job that materializes the nine zone auctions for each VERIFIED race entry, opens them at race-local midnight of day -12, and closes them at race-local midnight of day -5, marking the winner and the proof deadline.

**Architecture:** `AuctionSchedulerTask` (`@Interval(60_000)`) calls `AuctionService.runLifecycleTick(now)`, which runs three usecases in order (materialize, open, close), each with its own `*.usecase.db.ts`. All writes are idempotent compare-and-set, so several instances can tick concurrently without a lock. Window math lives in one pure helper on top of a new DST-correct `instantAtLocalMidnight`.

**Tech Stack:** NestJS 12 (ESM, `.js` import suffixes), Prisma 6.19.3, Vitest 5 with `vitest-mock-extended`, new dependency `@nestjs/schedule` 12.0.2 (exact).

**Spec:** `docs/specs/2026-10-09-auction-scheduling-design.md` (read sections 3 and 10 first; J1-J15 are the judgment calls this plan implements).

## Global Constraints

- Every dep pinned to an exact version: `@nestjs/schedule` is `12.0.2`, no caret/tilde. After `npm install`, rewrite the `package.json` entry to drop the caret npm adds.
- Window: `openAt` = 00:00 race-local of `raceLocalDate` - 12 days; `closeAt` = 00:00 race-local of `raceLocalDate` - 5 days; `proofDeadlineAt` = `raceDate` + 48 h.
- Tick interval 60_000 ms; page size 100; env flag `AUCTION_SCHEDULER_ENABLED` (default `true`).
- One schema change: append `NO_SALE` to `AuctionOutcome` with a hand-written migration (Task 4). No-sale = `status CLOSED`, `outcome NO_SALE`, no leading bid, `proofDeadlineAt null`; a never-opened `SCHEDULED` auction past `closeAt` also closes as `NO_SALE`.
- Hexagonal (CLAUDE.md): `*.service.ts` and `*.usecase.ts` never import `@prisma/client` or `src/prisma/` (`npm run lint:arch` enforces); only `*.db.ts` does. Call direction task -> service -> usecase -> usecase db. Each usecase has its own db class and its own Nest module (pattern: `src/races/usecases/review-verification/`).
- Style: explicit return types on every function; no single-letter names except `i/j/k` in indexed loops; braces on every `if`; blank line before `if/for/while/return/throw` unless first in block; no `!!x`; no nested function declarations; `readonly` constructor params; numeric separators on 5+ digit literals (`60_000`, `86_400_000`); no barrel files; no comments unless a non-obvious why; delete dead code.
- Branded types: `AuctionId`, `RaceEntryId`, `AthleteId`, `IanaTimezone`, `Cents`. Cast to a brand only inside `*.db.ts`. Errors are snake_case codes; readable detail goes to `this.logger` at the catch/skip site.
- Tests: Vitest, nested `describe` per condition ("when ..."), short `it` titles stating outcome only, shared setup in that describe's `beforeEach`. Usecase tests pass `now` as a parameter (no fake timers).
- Git: stage each task's files with `git add`; do NOT commit (user reviews with `/crit` first). Any later commit is Conventional Commits, e.g. `feat(auctions): add scheduled open and close job`, ending with the session's Co-Authored-By line. Branch is `hyr-08`; do not rename after a PR exists. Move Linear HYR-8 to In Progress at build start (check current state first), In Review only once staged.
- Gate after each task: `npm run lint`, `npm run lint:arch`, `npm test`, `npm run build`.

## Track layout

Backend-only. There is no frontend work and no HTTP surface. Tasks are sequential in numbering. T5, T6 and T7 (materialize, open, close usecases) depend only on T1-T4 and not on each other, so they may be parallelized across sub-agents if the executor wants; T7 (close) specifically needs T4 (`NO_SALE` in the generated Prisma client). T8 needs all three, T9 needs T8, T10 is QA and stays last.

## File structure

| File | Responsibility |
|---|---|
| `src/common/zoned-time.ts` | `instantAtLocalMidnight(localDate, timezone)` |
| `src/auctions/auction-window.ts` | `auctionWindow`, `proofDeadline`, day constants |
| `src/auctions/process-in-batches.ts` | id-cursor paging loop shared by the three usecases |
| `prisma/migrations/20261009100000_auction_outcome_no_sale/migration.sql` | `ALTER TYPE ... ADD VALUE 'NO_SALE'` |
| `src/auctions/usecases/materialize-auctions/*` | create missing `SCHEDULED` rows |
| `src/auctions/usecases/open-auctions/*` | `SCHEDULED` -> `OPEN` with floor snapshot |
| `src/auctions/usecases/close-auctions/*` | `OPEN`/`SCHEDULED` -> `CLOSED`, winner and proof deadline |
| `src/auctions/auction.service.ts` | `runLifecycleTick` orchestration |
| `src/auctions/auction-scheduler.task.ts` | `@Interval` entry point, flag, overlap guard |

---

### Task 1: Timezone helper `instantAtLocalMidnight`

**Files:**
- Create: `src/common/zoned-time.ts`, `src/common/zoned-time.spec.ts`

**Interfaces:**
- Consumes: `IanaTimezone` from `src/common/iana-timezone.ts`.
- Produces: `instantAtLocalMidnight(localDate: Date, timezone: IanaTimezone): Date`. `localDate` is a UTC-midnight `Date` representing a calendar date (same shape as `RaceEntry.raceLocalDate` and the return of `localDateInTimezone`). Returns the UTC instant at which that calendar date starts in `timezone`; if 00:00 does not exist that day (DST gap at midnight), returns the first valid instant of the day.

- [ ] **Step 1: Write the failing test** (`src/common/zoned-time.spec.ts`)

```ts
import type { IanaTimezone } from './iana-timezone';
import { instantAtLocalMidnight } from './zoned-time';

const chicago = 'America/Chicago' as IanaTimezone;
const havana = 'America/Havana' as IanaTimezone;
const auckland = 'Pacific/Auckland' as IanaTimezone;
const utc = 'UTC' as IanaTimezone;

function at(isoDate: string, timezone: IanaTimezone): string {
  return instantAtLocalMidnight(new Date(`${isoDate}T00:00:00Z`), timezone).toISOString();
}

describe('instantAtLocalMidnight', () => {
  describe('when the zone is UTC', () => {
    it('returns the same instant', () => {
      expect(at('2026-10-09', utc)).toBe('2026-10-09T00:00:00.000Z');
    });
  });

  describe('when the zone is behind UTC in daylight time', () => {
    it('adds the daylight offset', () => {
      expect(at('2026-10-27', chicago)).toBe('2026-10-27T05:00:00.000Z');
    });
  });

  describe('when the zone is behind UTC in standard time', () => {
    it('adds the standard offset', () => {
      expect(at('2026-11-03', chicago)).toBe('2026-11-03T06:00:00.000Z');
    });
  });

  describe('when the day is the US fall-back day', () => {
    it('uses the offset in force at midnight', () => {
      expect(at('2026-11-01', chicago)).toBe('2026-11-01T05:00:00.000Z');
    });
  });

  describe('when the day is the US spring-forward day', () => {
    it('uses the offset in force at midnight', () => {
      expect(at('2026-03-08', chicago)).toBe('2026-03-08T06:00:00.000Z');
    });
  });

  describe('when the zone is ahead of UTC', () => {
    it('returns the previous UTC day', () => {
      expect(at('2026-10-09', auckland)).toBe('2026-10-08T11:00:00.000Z');
    });
  });

  describe('when midnight does not exist because of a DST gap', () => {
    it('returns the first valid instant of the day', () => {
      expect(at('2026-03-08', havana)).toBe('2026-03-08T05:00:00.000Z');
    });
  });
});
```

(Auckland 2026-10-09 is NZDT? NZ DST starts the last Sunday of September, so Oct 9 is NZDT +13: local midnight Oct 9 = Oct 8 11:00Z. Havana 2026 DST starts second Sunday of March at 00:00 local: offset -5 until 05:00Z, then -4, so 00:00 does not exist and 01:00 local = 05:00Z. If the ICU data in the executor's Node build disagrees on either zone, check with `node -e` and adjust the zone/date, not the algorithm.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/common/zoned-time.spec.ts`
Expected: FAIL, cannot resolve `./zoned-time`.

- [ ] **Step 3: Implement** (`src/common/zoned-time.ts`)

```ts
import type { IanaTimezone } from './iana-timezone';

const MILLIS_PER_SECOND = 1000;

type WallPart = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

function wallClockAsUtc(instant: Date, timezone: IanaTimezone): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: WallPart): number => Number(parts.find((part) => part.type === type)?.value);

  return Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
}

function offsetMillis(instant: Date, timezone: IanaTimezone): number {
  const whole = new Date(Math.floor(instant.getTime() / MILLIS_PER_SECOND) * MILLIS_PER_SECOND);

  return wallClockAsUtc(whole, timezone) - whole.getTime();
}

export function instantAtLocalMidnight(localDate: Date, timezone: IanaTimezone): Date {
  const wall = localDate.getTime();
  const first = new Date(wall - offsetMillis(new Date(wall), timezone));
  const second = new Date(wall - offsetMillis(first, timezone));

  if (wallClockAsUtc(second, timezone) === wall) {
    return second;
  }

  return new Date(Math.max(first.getTime(), second.getTime()));
}
```

The nested arrow `value` inside `wallClockAsUtc` is a const arrow, not a function declaration, so it satisfies the no-nested-declarations rule; if the linter objects, extract it to a module-level `partValue(parts, type)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/common/zoned-time.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Gate and stage**

Run: `npm run lint && npm run lint:arch && npm test && npm run build`, then `git add src/common/zoned-time.ts src/common/zoned-time.spec.ts`.

---

### Task 2: Window helper and paging helper

**Files:**
- Create: `src/auctions/auction-window.ts`, `src/auctions/auction-window.spec.ts`, `src/auctions/process-in-batches.ts`, `src/auctions/process-in-batches.spec.ts`

**Interfaces:**
- Consumes: `instantAtLocalMidnight` (Task 1).
- Produces:
  - `OPEN_DAYS_BEFORE_RACE = 12`, `CLOSE_DAYS_BEFORE_RACE = 5`, `PROOF_WINDOW_HOURS = 48`
  - `type AuctionWindow = { openAt: Date; closeAt: Date }`
  - `auctionWindow(raceLocalDate: Date, timezone: IanaTimezone): AuctionWindow`
  - `proofDeadline(raceDate: Date): Date`
  - `BATCH_SIZE = 100`
  - `processInBatches<Item, Cursor>(fetchPage: (after: Cursor | null, limit: number) => Promise<Item[]>, cursorOf: (item: Item) => Cursor, handlePage: (items: Item[]) => Promise<void>): Promise<void>` calls `fetchPage(null, BATCH_SIZE)`, hands each non-empty page to `handlePage`, continues from the last item's cursor while the page was full, stops on a short or empty page.

- [ ] **Step 1: Write the failing tests**

`src/auctions/auction-window.spec.ts`:

```ts
import type { IanaTimezone } from '../common/iana-timezone';
import { auctionWindow, proofDeadline } from './auction-window';

const chicago = 'America/Chicago' as IanaTimezone;

describe('auctionWindow', () => {
  describe('when no DST change falls inside the window', () => {
    it('opens at local midnight 12 days before the race day', () => {
      const window = auctionWindow(new Date('2026-11-14T00:00:00Z'), chicago);

      expect(window.openAt.toISOString()).toBe('2026-11-02T06:00:00.000Z');
    });

    it('closes at local midnight 5 days before the race day', () => {
      const window = auctionWindow(new Date('2026-11-14T00:00:00Z'), chicago);

      expect(window.closeAt.toISOString()).toBe('2026-11-09T06:00:00.000Z');
    });
  });

  describe('when the DST change falls inside the window', () => {
    it('keeps both boundaries at local midnight', () => {
      const window = auctionWindow(new Date('2026-11-08T00:00:00Z'), chicago);

      expect(window.openAt.toISOString()).toBe('2026-10-27T05:00:00.000Z');
      expect(window.closeAt.toISOString()).toBe('2026-11-03T06:00:00.000Z');
    });
  });

  describe('when the window crosses a month and year boundary', () => {
    it('counts calendar days', () => {
      const window = auctionWindow(new Date('2027-01-04T00:00:00Z'), 'UTC' as IanaTimezone);

      expect(window.openAt.toISOString()).toBe('2026-12-23T00:00:00.000Z');
      expect(window.closeAt.toISOString()).toBe('2026-12-30T00:00:00.000Z');
    });
  });
});

describe('proofDeadline', () => {
  it('is 48 hours after the race start', () => {
    expect(proofDeadline(new Date('2026-11-14T15:00:00Z')).toISOString()).toBe('2026-11-16T15:00:00.000Z');
  });
});
```

`src/auctions/process-in-batches.spec.ts`:

```ts
import { BATCH_SIZE, processInBatches } from './process-in-batches';

type Row = { id: number };

function rows(from: number, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: from + index }));
}

describe('processInBatches', () => {
  let handled: Row[][];
  let cursors: Array<number | null>;

  beforeEach(() => {
    handled = [];
    cursors = [];
  });

  describe('when the first page is full and the second is short', () => {
    it('fetches from the last cursor and stops', async () => {
      const pages = [rows(1, BATCH_SIZE), rows(BATCH_SIZE + 1, 3)];

      await processInBatches<Row, number>(
        (after) => {
          cursors.push(after);

          return Promise.resolve(pages.shift() ?? []);
        },
        (row) => row.id,
        (items) => {
          handled.push(items);

          return Promise.resolve();
        },
      );

      expect(cursors).toEqual([null, BATCH_SIZE]);
      expect(handled.map((page) => page.length)).toEqual([BATCH_SIZE, 3]);
    });
  });

  describe('when the first page is empty', () => {
    it('never calls the handler', async () => {
      await processInBatches<Row, number>(
        () => Promise.resolve([]),
        (row) => row.id,
        (items) => {
          handled.push(items);

          return Promise.resolve();
        },
      );

      expect(handled).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/auctions/auction-window.spec.ts src/auctions/process-in-batches.spec.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/auctions/auction-window.ts`:

```ts
import type { IanaTimezone } from '../common/iana-timezone';
import { instantAtLocalMidnight } from '../common/zoned-time';

export const OPEN_DAYS_BEFORE_RACE = 12;
export const CLOSE_DAYS_BEFORE_RACE = 5;
export const PROOF_WINDOW_HOURS = 48;

const MILLIS_PER_HOUR = 3_600_000;
const MILLIS_PER_DAY = 86_400_000;

export type AuctionWindow = { openAt: Date; closeAt: Date };

function daysBefore(localDate: Date, days: number): Date {
  return new Date(localDate.getTime() - days * MILLIS_PER_DAY);
}

export function auctionWindow(raceLocalDate: Date, timezone: IanaTimezone): AuctionWindow {
  return {
    openAt: instantAtLocalMidnight(daysBefore(raceLocalDate, OPEN_DAYS_BEFORE_RACE), timezone),
    closeAt: instantAtLocalMidnight(daysBefore(raceLocalDate, CLOSE_DAYS_BEFORE_RACE), timezone),
  };
}

export function proofDeadline(raceDate: Date): Date {
  return new Date(raceDate.getTime() + PROOF_WINDOW_HOURS * MILLIS_PER_HOUR);
}
```

`src/auctions/process-in-batches.ts`:

```ts
export const BATCH_SIZE = 100;

export async function processInBatches<Item, Cursor>(
  fetchPage: (after: Cursor | null, limit: number) => Promise<Item[]>,
  cursorOf: (item: Item) => Cursor,
  handlePage: (items: Item[]) => Promise<void>,
): Promise<void> {
  let after: Cursor | null = null;
  let page = await fetchPage(after, BATCH_SIZE);

  while (page.length > 0) {
    await handlePage(page);

    if (page.length < BATCH_SIZE) {
      return;
    }

    after = cursorOf(page[page.length - 1]);
    page = await fetchPage(after, BATCH_SIZE);
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/auctions/auction-window.spec.ts src/auctions/process-in-batches.spec.ts`
Expected: PASS.

- [ ] **Step 5: Gate and stage** the four files.

---

### Task 3: Dependency and env flag

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/config/env.validation.ts`, `src/config/env.validation.spec.ts`, `.env.example`, `README.md`

**Interfaces:**
- Produces: `EnvironmentVariables.AUCTION_SCHEDULER_ENABLED: boolean` (default `true`); `@nestjs/schedule` available.

- [ ] **Step 1: Write the failing tests** (append to `src/config/env.validation.spec.ts`, inside `describe('validateEnv')`)

```ts
  describe('AUCTION_SCHEDULER_ENABLED', () => {
    describe('when unset', () => {
      it('defaults to true', () => {
        expect(validateEnv(validEnv).AUCTION_SCHEDULER_ENABLED).toBe(true);
      });
    });

    describe('when set to the string false', () => {
      it('parses to false', () => {
        expect(validateEnv({ ...validEnv, AUCTION_SCHEDULER_ENABLED: 'false' }).AUCTION_SCHEDULER_ENABLED).toBe(
          false,
        );
      });
    });

    describe('when set to the string true', () => {
      it('parses to true', () => {
        expect(validateEnv({ ...validEnv, AUCTION_SCHEDULER_ENABLED: 'true' }).AUCTION_SCHEDULER_ENABLED).toBe(
          true,
        );
      });
    });

    describe('when set to anything else', () => {
      it('rejects the env', () => {
        expect(() => validateEnv({ ...validEnv, AUCTION_SCHEDULER_ENABLED: 'yes' })).toThrow('env_invalid');
      });
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/config/env.validation.spec.ts`
Expected: FAIL (property undefined / no rejection).

- [ ] **Step 3: Install and pin the dependency**

Run: `npm install @nestjs/schedule@12.0.2`. Then edit `package.json` so the entry is exactly `"@nestjs/schedule": "12.0.2"` (no caret). Run `npm install` again to refresh the lockfile.

- [ ] **Step 4: Implement the flag** in `EnvironmentVariables` (add `IsBoolean` to the class-validator import):

```ts
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  AUCTION_SCHEDULER_ENABLED: boolean = true;
```

Note `plainToInstance` does not run the Transform for an absent key unless `exposeDefaultValues` is set; the class initializer supplies `true` in that case, which is why the default is both here and in the initializer. Confirm the "unset" test passes via the initializer.

- [ ] **Step 5: Docs.** Add `AUCTION_SCHEDULER_ENABLED=true` to `.env.example`. In `README.md` add an "Auction scheduling" section: the job runs in-process every 60 s; open at race-local midnight of day -12, close at day -5; set `AUCTION_SCHEDULER_ENABLED=false` on replicas or local workspaces that should not tick; note that if disabled everywhere auctions silently stall; link the spec.

- [ ] **Step 6: Run to verify pass**, then gate, then `git add package.json package-lock.json src/config/env.validation.ts src/config/env.validation.spec.ts .env.example README.md`.

---

### Task 4: `NO_SALE` outcome enum and migration

**Files:**
- Modify: `prisma/schema.prisma` (enum `AuctionOutcome`, around line 164), `docs/specs/2026-09-28-core-data-model-design.md` (already annotated by the planner; verify)
- Create: `prisma/migrations/20261009100000_auction_outcome_no_sale/migration.sql`

**Interfaces:**
- Produces: `AuctionOutcome` includes `NO_SALE` in the Prisma client and in the Postgres enum `auction_outcome`. Task 7 sets it.

No unit test applies (schema only); verification is the shadow-database diff plus a regenerate-and-compile check.

- [ ] **Step 1: Confirm nothing switches exhaustively on the enum.** Run `grep -rniE "AuctionOutcome|AWAITING_PROOF|FORFEITED_FEE|auction_outcome" src shared/src web/src prisma README.md`. Expected hits only in `prisma/schema.prisma` and `prisma/migrations/20260929090000_init/migration.sql`. If anything else appears, add `NO_SALE` handling there and note it in the report.
- [ ] **Step 2: Edit the schema.** Append `NO_SALE` as the last value of `enum AuctionOutcome` (after `FORFEITED_FEE`, before `@@map("auction_outcome")`). Appending matches the order Postgres `ADD VALUE` produces.
- [ ] **Step 3: Write the migration** (`prisma/migrations/20261009100000_auction_outcome_no_sale/migration.sql`):

```sql
-- AlterEnum
ALTER TYPE "auction_outcome" ADD VALUE 'NO_SALE';
```

The folder timestamp sorts after `20261003110000_race_entry_verification`. `prisma migrate dev --create-only` does not run non-interactively here, so hand-write it (project memory note) and check it with the diff below.
- [ ] **Step 4: Check against the schema** using the shadow-database procedure in `README.md` ("Hand-written SQL and `prisma migrate dev`"): create `shadow_check`, run `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://hyrox:hyrox@localhost:5435/shadow_check?schema=public" --script`, expect `-- This is an empty migration.`, then drop the shadow database. If port 5435 is held by another workspace, use a throwaway container on another port.
- [ ] **Step 5: Apply and regenerate.** `npx prisma migrate deploy` against the dev database and `npx prisma generate`; run `psql -c "SELECT unnest(enum_range(NULL::auction_outcome))"` and expect `NO_SALE` last.
- [ ] **Step 6: Gate** (`npm run lint`, `npm run lint:arch`, `npm test`, `npm run build`), then `git add prisma/schema.prisma prisma/migrations/20261009100000_auction_outcome_no_sale docs/specs/2026-09-28-core-data-model-design.md`.

---

### Task 5: Materialize usecase

**Files:**
- Create: `src/auctions/usecases/materialize-auctions/materialize-auctions.usecase.ts`, `.usecase.db.ts`, `.module.ts`, `.usecase.spec.ts`, `.usecase.db.spec.ts`

**Interfaces:**
- Consumes: `auctionWindow`, `processInBatches`, `BATCH_SIZE` (Task 2); `RaceEntryService.assertVerified(raceEntryId: RaceEntryId): Promise<void>` (exported by `RacesModule`); `ZoneFloorPriceService.listForAthlete(athleteId): Promise<ZoneFloorPriceView[]>` (`{ zone, floorPriceCents: Cents, isDefault }`, exported by `ZonesModule`); `ZONE_ORDER`/`BodyZoneValue` from `src/zones/zone-order.ts`.
- Produces:
  - db: `MaterializeAuctionsUsecaseDb.findCandidates(now: Date, after: RaceEntryId | null, limit: number): Promise<MaterializeCandidate[]>` with `MaterializeCandidate = { raceEntryId: RaceEntryId; athleteId: AthleteId; raceLocalDate: Date; timezone: IanaTimezone }`; `createScheduled(rows: NewAuctionRow[]): Promise<number>` with `NewAuctionRow = { raceEntryId: RaceEntryId; zone: BodyZoneValue; floorPriceCents: Cents; openAt: Date; closeAt: Date }`.
  - usecase: `MaterializeAuctionsUsecase.execute(now: Date): Promise<number>` returns auctions created.
  - `MaterializeAuctionsModule` providing and exporting the usecase; imports `RacesModule` and `ZonesModule`.

- [ ] **Step 1: Write the failing db spec** (pattern: `log-race.usecase.db.spec.ts`)

```ts
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RaceEntryId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { MaterializeAuctionsUsecaseDb } from './materialize-auctions.usecase.db';

describe('MaterializeAuctionsUsecaseDb', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  let prisma: DeepMockProxy<PrismaService>;
  let db: MaterializeAuctionsUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new MaterializeAuctionsUsecaseDb(prisma);
  });

  describe('findCandidates', () => {
    beforeEach(() => {
      prisma.raceEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1',
          athleteId: 'athlete-1',
          raceLocalDate: new Date('2026-11-14T00:00:00Z'),
          race: { timezone: 'America/Chicago' },
        },
      ] as never);
    });

    it('filters to verified, unbanned, future entries without auctions', async () => {
      await db.findCandidates(now, null, 100);

      expect(prisma.raceEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            verificationStatus: 'VERIFIED',
            auctions: { none: {} },
            raceDate: { gt: now },
            athlete: { isBanned: false },
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      );
    });

    it('starts after the cursor when given one', async () => {
      await db.findCandidates(now, 'entry-0' as RaceEntryId, 100);

      expect(prisma.raceEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'entry-0' }, skip: 1 }),
      );
    });

    it('returns branded candidates', async () => {
      const result = await db.findCandidates(now, null, 100);

      expect(result).toEqual([
        {
          raceEntryId: 'entry-1',
          athleteId: 'athlete-1',
          raceLocalDate: new Date('2026-11-14T00:00:00Z'),
          timezone: 'America/Chicago',
        },
      ]);
    });
  });

  describe('createScheduled', () => {
    it('inserts with skipDuplicates and returns the created count', async () => {
      prisma.auction.createMany.mockResolvedValue({ count: 9 });
      const openAt = new Date('2026-11-02T06:00:00Z');
      const closeAt = new Date('2026-11-09T06:00:00Z');

      const result = await db.createScheduled([
        { raceEntryId: 'entry-1' as RaceEntryId, zone: 'LEFT_PEC', floorPriceCents: cents(1000), openAt, closeAt },
      ]);

      expect(prisma.auction.createMany).toHaveBeenCalledWith({
        data: [{ raceEntryId: 'entry-1', zone: 'LEFT_PEC', floorPriceCents: 1000, openAt, closeAt }],
        skipDuplicates: true,
      });
      expect(result).toBe(9);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure:** `npx vitest run src/auctions/usecases/materialize-auctions`. Expected FAIL.

- [ ] **Step 3: Implement the db** (`materialize-auctions.usecase.db.ts`)

```ts
import { Injectable } from '@nestjs/common';
import type { AthleteId, RaceEntryId } from '../../../common/ids';
import { ianaTimezone, type IanaTimezone } from '../../../common/iana-timezone';
import type { Cents } from '../../../common/money';
import { PrismaService } from '../../../prisma/prisma.service';
import type { BodyZoneValue } from '../../../zones/zone-order';

export type MaterializeCandidate = {
  raceEntryId: RaceEntryId;
  athleteId: AthleteId;
  raceLocalDate: Date;
  timezone: IanaTimezone;
};

export type NewAuctionRow = {
  raceEntryId: RaceEntryId;
  zone: BodyZoneValue;
  floorPriceCents: Cents;
  openAt: Date;
  closeAt: Date;
};

@Injectable()
export class MaterializeAuctionsUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    now: Date,
    after: RaceEntryId | null,
    limit: number,
  ): Promise<MaterializeCandidate[]> {
    const entries = await this.prisma.raceEntry.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        auctions: { none: {} },
        raceDate: { gt: now },
        athlete: { isBanned: false },
      },
      select: { id: true, athleteId: true, raceLocalDate: true, race: { select: { timezone: true } } },
      orderBy: { id: 'asc' },
      take: limit,
      ...(after === null ? {} : { cursor: { id: after }, skip: 1 }),
    });

    return entries.map((entry) => ({
      raceEntryId: entry.id as RaceEntryId,
      athleteId: entry.athleteId as AthleteId,
      raceLocalDate: entry.raceLocalDate,
      timezone: ianaTimezone(entry.race.timezone),
    }));
  }

  async createScheduled(rows: NewAuctionRow[]): Promise<number> {
    const result = await this.prisma.auction.createMany({ data: rows, skipDuplicates: true });

    return result.count;
  }
}
```

The `entries.map` here brands only the id and athlete fields at the I/O boundary, which the conventions allow (`*.db.ts` ORM reads); it is a projection of selected columns, not a record remap.

- [ ] **Step 4: Write the failing usecase spec**

```ts
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ConflictError } from '../../../common/domain-error';
import type { AthleteId, RaceEntryId } from '../../../common/ids';
import type { IanaTimezone } from '../../../common/iana-timezone';
import { cents } from '../../../common/money';
import { RaceEntryService } from '../../../races/race-entry.service';
import { ZONE_ORDER } from '../../../zones/zone-order';
import { ZoneFloorPriceService } from '../../../zones/zone-floor-price.service';
import { MaterializeAuctionsUsecase } from './materialize-auctions.usecase';
import { MaterializeAuctionsUsecaseDb, type MaterializeCandidate } from './materialize-auctions.usecase.db';

const now = new Date('2026-10-20T12:00:00Z');
const candidate: MaterializeCandidate = {
  raceEntryId: 'entry-1' as RaceEntryId,
  athleteId: 'athlete-1' as AthleteId,
  raceLocalDate: new Date('2026-11-14T00:00:00Z'),
  timezone: 'America/Chicago' as IanaTimezone,
};

describe('MaterializeAuctionsUsecase', () => {
  let db: DeepMockProxy<MaterializeAuctionsUsecaseDb>;
  let entries: DeepMockProxy<RaceEntryService>;
  let floors: DeepMockProxy<ZoneFloorPriceService>;
  let usecase: MaterializeAuctionsUsecase;
  let warn: MockInstance;

  beforeEach(async () => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<MaterializeAuctionsUsecaseDb>();
    entries = mockDeep<RaceEntryService>();
    floors = mockDeep<ZoneFloorPriceService>();
    db.findCandidates.mockResolvedValueOnce([candidate]);
    db.createScheduled.mockResolvedValue(9);
    entries.assertVerified.mockResolvedValue(undefined);
    floors.listForAthlete.mockResolvedValue(
      ZONE_ORDER.map((zone) => ({ zone, floorPriceCents: cents(2500), isDefault: false })),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        MaterializeAuctionsUsecase,
        { provide: MaterializeAuctionsUsecaseDb, useValue: db },
        { provide: RaceEntryService, useValue: entries },
        { provide: ZoneFloorPriceService, useValue: floors },
      ],
    }).compile();
    usecase = moduleRef.get(MaterializeAuctionsUsecase);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the window has not ended', () => {
    it('creates one scheduled row per zone with the window and the athlete floor', async () => {
      const created = await usecase.execute(now);

      expect(created).toBe(9);
      expect(db.createScheduled).toHaveBeenCalledWith(
        ZONE_ORDER.map((zone) => ({
          raceEntryId: candidate.raceEntryId,
          zone,
          floorPriceCents: cents(2500),
          openAt: new Date('2026-11-02T06:00:00Z'),
          closeAt: new Date('2026-11-09T06:00:00Z'),
        })),
      );
    });
  });

  describe('when verified after the window opened but before it closes', () => {
    it('still creates the rows with the original close', async () => {
      await usecase.execute(new Date('2026-11-05T12:00:00Z'));

      expect(db.createScheduled).toHaveBeenCalledOnce();
    });
  });

  describe('when the close time has already passed', () => {
    it('creates nothing', async () => {
      const created = await usecase.execute(new Date('2026-11-09T06:00:00Z'));

      expect(created).toBe(0);
      expect(db.createScheduled).not.toHaveBeenCalled();
    });
  });

  describe('when the verification gate rejects the entry', () => {
    beforeEach(() => {
      entries.assertVerified.mockRejectedValue(new ConflictError('race_entry_not_verified'));
    });

    it('skips the entry and creates nothing', async () => {
      const created = await usecase.execute(now);

      expect(created).toBe(0);
      expect(db.createScheduled).not.toHaveBeenCalled();
    });

    it('logs the skip', async () => {
      await usecase.execute(now);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('entry-1'));
    });
  });

  describe('when creating rows for one entry throws', () => {
    beforeEach(() => {
      db.findCandidates.mockReset();
      db.findCandidates.mockResolvedValueOnce([
        candidate,
        { ...candidate, raceEntryId: 'entry-2' as RaceEntryId },
      ]);
      db.createScheduled.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(9);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    it('still processes the next entry', async () => {
      const created = await usecase.execute(now);

      expect(created).toBe(9);
    });
  });
});
```

- [ ] **Step 5: Implement the usecase**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/domain-error';
import { RaceEntryService } from '../../../races/race-entry.service';
import { ZoneFloorPriceService } from '../../../zones/zone-floor-price.service';
import { auctionWindow } from '../../auction-window';
import { processInBatches } from '../../../auctions/process-in-batches';
import {
  MaterializeAuctionsUsecaseDb,
  type MaterializeCandidate,
  type NewAuctionRow,
} from './materialize-auctions.usecase.db';

@Injectable()
export class MaterializeAuctionsUsecase {
  private readonly logger = new Logger(MaterializeAuctionsUsecase.name);

  constructor(
    private readonly db: MaterializeAuctionsUsecaseDb,
    private readonly raceEntries: RaceEntryService,
    private readonly floorPrices: ZoneFloorPriceService,
  ) {}

  async execute(now: Date): Promise<number> {
    let created = 0;

    await processInBatches(
      (after, limit) => this.db.findCandidates(now, after, limit),
      (candidate) => candidate.raceEntryId,
      async (page) => {
        for (const candidate of page) {
          created += await this.materialize(candidate, now);
        }
      },
    );

    return created;
  }

  private async materialize(candidate: MaterializeCandidate, now: Date): Promise<number> {
    const window = auctionWindow(candidate.raceLocalDate, candidate.timezone);

    if (window.closeAt.getTime() <= now.getTime()) {
      return 0;
    }

    try {
      await this.raceEntries.assertVerified(candidate.raceEntryId);

      const prices = await this.floorPrices.listForAthlete(candidate.athleteId);
      const rows: NewAuctionRow[] = prices.map((price) => ({
        raceEntryId: candidate.raceEntryId,
        zone: price.zone,
        floorPriceCents: price.floorPriceCents,
        openAt: window.openAt,
        closeAt: window.closeAt,
      }));

      return await this.db.createScheduled(rows);
    } catch (error) {
      return this.skip(candidate, error);
    }
  }

  private skip(candidate: MaterializeCandidate, error: unknown): number {
    if (error instanceof ConflictError || error instanceof NotFoundError) {
      this.logger.warn(`Race entry ${candidate.raceEntryId} skipped: ${error.code}`);

      return 0;
    }

    this.logger.error(
      `Race entry ${candidate.raceEntryId} failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    return 0;
  }
}
```

- [ ] **Step 6: Module** (`materialize-auctions.module.ts`)

```ts
import { Module } from '@nestjs/common';
import { RacesModule } from '../../../races/races.module';
import { ZonesModule } from '../../../zones/zones.module';
import { MaterializeAuctionsUsecase } from './materialize-auctions.usecase';
import { MaterializeAuctionsUsecaseDb } from './materialize-auctions.usecase.db';

@Module({
  imports: [RacesModule, ZonesModule],
  providers: [MaterializeAuctionsUsecase, MaterializeAuctionsUsecaseDb],
  exports: [MaterializeAuctionsUsecase],
})
export class MaterializeAuctionsModule {}
```

- [ ] **Step 7: Run to verify pass:** `npx vitest run src/auctions/usecases/materialize-auctions`. Then gate (confirm `lint:arch` is clean: the usecase imports no Prisma; `zone-order.ts` only has a type import) and `git add src/auctions/usecases/materialize-auctions`.

---

### Task 6: Open usecase

**Files:**
- Create: `src/auctions/usecases/open-auctions/open-auctions.usecase.ts`, `.usecase.db.ts`, `.module.ts`, `.usecase.spec.ts`, `.usecase.db.spec.ts`

**Interfaces:**
- Consumes: `processInBatches`; `RaceEntryService.assertVerified`; `ZoneFloorPriceService.listForAthlete`; `AuctionId`, `RaceEntryId`, `AthleteId`; `BodyZoneValue`.
- Produces:
  - db: `OpenAuctionsUsecaseDb.findDue(now: Date, after: AuctionId | null, limit: number): Promise<DueToOpen[]>` with `DueToOpen = { auctionId: AuctionId; raceEntryId: RaceEntryId; athleteId: AthleteId; zone: BodyZoneValue }`; `markOpen(auctionId: AuctionId, floorPriceCents: Cents, now: Date): Promise<number>` (rows updated, 0 or 1).
  - usecase: `OpenAuctionsUsecase.execute(now: Date): Promise<number>` returns auctions opened.
  - `OpenAuctionsModule` (imports `RacesModule`, `ZonesModule`; exports the usecase).

- [ ] **Step 1: Write the failing db spec.** Assert, with `mockDeep<PrismaService>()`:
  - `findDue` calls `auction.findMany` with `where: { status: 'SCHEDULED', openAt: { lte: now }, closeAt: { gt: now }, raceEntry: { verificationStatus: 'VERIFIED', athlete: { isBanned: false } } }`, `orderBy: { id: 'asc' }`, `take: limit`, `select` including `raceEntry: { select: { athleteId: true } }`, and `cursor: { id }, skip: 1` only when `after` is given; returns branded `DueToOpen` items (`raceEntry.athleteId` flattened to `athleteId`).
  - `markOpen` calls `auction.updateMany` with `where: { id, status: 'SCHEDULED', openAt: { lte: now }, closeAt: { gt: now }, raceEntry: { verificationStatus: 'VERIFIED', athlete: { isBanned: false } } }` and `data: { status: 'OPEN', floorPriceCents }`, returning `count`.

  Use the same structure as Task 5's db spec (separate `describe` per method, `beforeEach` stubs `findMany`/`updateMany` with `as never`).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement the db**

```ts
import { Injectable } from '@nestjs/common';
import type { AthleteId, AuctionId, RaceEntryId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { PrismaService } from '../../../prisma/prisma.service';
import type { BodyZoneValue } from '../../../zones/zone-order';

export type DueToOpen = {
  auctionId: AuctionId;
  raceEntryId: RaceEntryId;
  athleteId: AthleteId;
  zone: BodyZoneValue;
};

const OPENABLE_ENTRY = { verificationStatus: 'VERIFIED', athlete: { isBanned: false } } as const;

@Injectable()
export class OpenAuctionsUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findDue(now: Date, after: AuctionId | null, limit: number): Promise<DueToOpen[]> {
    const auctions = await this.prisma.auction.findMany({
      where: {
        status: 'SCHEDULED',
        openAt: { lte: now },
        closeAt: { gt: now },
        raceEntry: OPENABLE_ENTRY,
      },
      select: { id: true, raceEntryId: true, zone: true, raceEntry: { select: { athleteId: true } } },
      orderBy: { id: 'asc' },
      take: limit,
      ...(after === null ? {} : { cursor: { id: after }, skip: 1 }),
    });

    return auctions.map((auction) => ({
      auctionId: auction.id as AuctionId,
      raceEntryId: auction.raceEntryId as RaceEntryId,
      athleteId: auction.raceEntry.athleteId as AthleteId,
      zone: auction.zone,
    }));
  }

  async markOpen(auctionId: AuctionId, floorPriceCents: Cents, now: Date): Promise<number> {
    const result = await this.prisma.auction.updateMany({
      where: {
        id: auctionId,
        status: 'SCHEDULED',
        openAt: { lte: now },
        closeAt: { gt: now },
        raceEntry: OPENABLE_ENTRY,
      },
      data: { status: 'OPEN', floorPriceCents },
    });

    return result.count;
  }
}
```

- [ ] **Step 4: Write the failing usecase spec.** `describe('OpenAuctionsUsecase')` with mocks for db, `RaceEntryService`, `ZoneFloorPriceService` (same harness as Task 4). Cases, each its own `describe`:
  - when two due auctions belong to the same entry and athlete: `assertVerified` called once per entry, `listForAthlete` called once per athlete, `markOpen` called twice with each zone's price from the list (use prices 2500 for LEFT_PEC and 1000 default for RIGHT_PEC) and `now`; returns 2.
  - when the athlete has no saved price (listForAthlete returns default 1000 entries): snapshot is 1000.
  - when `markOpen` resolves 0 (another instance won): returns 0 for that auction, no error.
  - when `assertVerified` rejects `ConflictError('race_entry_not_verified')`: `markOpen` not called for that entry's auctions, warn logged with the entry id; other entries still processed.
  - when `markOpen` rejects with a generic `Error`: error logged, next auction still processed.
  - when the first page is full: the usecase asks `findDue` again with the last auction id (assert second call's `after`).

- [ ] **Step 5: Implement the usecase**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/domain-error';
import type { AthleteId, RaceEntryId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { RaceEntryService } from '../../../races/race-entry.service';
import type { BodyZoneValue } from '../../../zones/zone-order';
import { ZoneFloorPriceService } from '../../../zones/zone-floor-price.service';
import { processInBatches } from '../../../auctions/process-in-batches';
import { OpenAuctionsUsecaseDb, type DueToOpen } from './open-auctions.usecase.db';

@Injectable()
export class OpenAuctionsUsecase {
  private readonly logger = new Logger(OpenAuctionsUsecase.name);

  constructor(
    private readonly db: OpenAuctionsUsecaseDb,
    private readonly raceEntries: RaceEntryService,
    private readonly floorPrices: ZoneFloorPriceService,
  ) {}

  async execute(now: Date): Promise<number> {
    let opened = 0;
    const verifiedByRaceEntry = new Map<RaceEntryId, boolean>();
    const floorsByAthlete = new Map<AthleteId, Map<BodyZoneValue, Cents>>();

    await processInBatches(
      (after, limit) => this.db.findDue(now, after, limit),
      (due) => due.auctionId,
      async (page) => {
        for (const due of page) {
          opened += await this.open(due, now, verifiedByRaceEntry, floorsByAthlete);
        }
      },
    );

    return opened;
  }

  private async open(
    due: DueToOpen,
    now: Date,
    verifiedByRaceEntry: Map<RaceEntryId, boolean>,
    floorsByAthlete: Map<AthleteId, Map<BodyZoneValue, Cents>>,
  ): Promise<number> {
    try {
      if (!(await this.isRaceEntryVerified(due.raceEntryId, verifiedByRaceEntry))) {
        return 0;
      }

      const floors = await this.getAthleteFloors(due.athleteId, floorsByAthlete);
      const floor = floors.get(due.zone);

      if (floor === undefined) {
        this.logger.error(`No floor price resolved for auction ${due.auctionId} zone ${due.zone}`);

        return 0;
      }

      return await this.db.markOpen(due.auctionId, floor, now);
    } catch (error) {
      this.logger.error(
        `Auction ${due.auctionId} failed to open: ${error instanceof Error ? error.message : String(error)}`,
      );

      return 0;
    }
  }

  private async isRaceEntryVerified(raceEntryId: RaceEntryId, verifiedByRaceEntry: Map<RaceEntryId, boolean>): Promise<boolean> {
    const known = verifiedByRaceEntry.get(raceEntryId);

    if (known !== undefined) {
      return known;
    }

    try {
      await this.raceEntries.assertVerified(raceEntryId);
      verifiedByRaceEntry.set(raceEntryId, true);

      return true;
    } catch (error) {
      if (error instanceof ConflictError || error instanceof NotFoundError) {
        this.logger.warn(`Race entry ${raceEntryId} not opened: ${error.code}`);
        verifiedByRaceEntry.set(raceEntryId, false);

        return false;
      }

      throw error;
    }
  }

  private async getAthleteFloors(
    athleteId: AthleteId,
    floorsByAthlete: Map<AthleteId, Map<BodyZoneValue, Cents>>,
  ): Promise<Map<BodyZoneValue, Cents>> {
    const known = floorsByAthlete.get(athleteId);

    if (known !== undefined) {
      return known;
    }

    const prices = await this.floorPrices.listForAthlete(athleteId);
    const floors = new Map<BodyZoneValue, Cents>(prices.map((price) => [price.zone, price.floorPriceCents]));

    floorsByAthlete.set(athleteId, floors);

    return floors;
  }
}
```

`if (!(await ...))` is a single negation, allowed. Tick-scoped caches are local to `execute`, so a floor edit between ticks is always picked up.

- [ ] **Step 6: Module** (mirror Task 5's, with `OpenAuctionsUsecase`/`OpenAuctionsUsecaseDb`).

- [ ] **Step 7: Run tests, gate, `git add src/auctions/usecases/open-auctions`.**

---

### Task 7: Close usecase

**Files:**
- Create: `src/auctions/usecases/close-auctions/close-auctions.usecase.ts`, `.usecase.db.ts`, `.module.ts`, `.usecase.spec.ts`, `.usecase.db.spec.ts`

**Interfaces:**
- Consumes: `processInBatches`, `proofDeadline` (Task 2), `AuctionId`; the regenerated Prisma client with `AuctionOutcome.NO_SALE` (Task 4).
- Produces:
  - db: `CloseAuctionsUsecaseDb.findDue(now: Date, after: AuctionId | null, limit: number): Promise<DueToClose[]>` with `DueToClose = { auctionId: AuctionId; raceDate: Date }`; `closeAuction(auctionId: AuctionId, now: Date, proofDeadlineAt: Date): Promise<CloseResult>` with `CloseResult = 'already_closed' | 'no_sale' | 'won'`.
  - usecase: `CloseAuctionsUsecase.execute(now: Date): Promise<CloseTotals>` with `CloseTotals = { won: number; noSale: number }`.
  - `CloseAuctionsModule` (no external imports; exports the usecase).

- [ ] **Step 1: Write the failing db spec.** With `mockDeep<PrismaService>()` and `$transaction` mocked as in `log-race.usecase.db.spec.ts` (callback invoked with a `tx` deep mock). Cases:
  - `findDue`: `where: { status: { in: ['SCHEDULED', 'OPEN'] }, closeAt: { lte: now } }`, `select` includes `raceEntry: { select: { raceDate: true } }`, ordered by id, cursor only when `after` given; returns `{ auctionId, raceDate }`.
  - `closeAuction` when `tx.auction.updateMany` resolves `{ count: 0 }`: returns `'already_closed'`, no bid reads or writes. Assert the CAS call: `where: { id, status: { in: ['SCHEDULED', 'OPEN'] }, closeAt: { lte: now } }`, `data: { status: 'CLOSED' }`.
  - when count is 1 and `tx.bid.findFirst` (where `{ auctionId, status: 'LEADING' }`) resolves null: calls `tx.auction.update({ where: { id: auctionId }, data: { outcome: 'NO_SALE' } })` exactly once, makes no `bid.update`/`bid.updateMany` call, returns `'no_sale'`.
  - when the auction was never opened (the CAS matched a `SCHEDULED` row; the mock cannot tell, so assert only that the CAS `where.status.in` contains both `'SCHEDULED'` and `'OPEN'`): same `NO_SALE` result path.
  - when a leading bid `{ id: 'bid-1' }` exists: `tx.bid.update({ where: { id: 'bid-1' }, data: { status: 'WON' } })`, `tx.bid.updateMany({ where: { auctionId, id: { not: 'bid-1' }, status: 'OUTBID' }, data: { status: 'LOST' } })`, `tx.auction.update({ where: { id }, data: { outcome: 'AWAITING_PROOF', proofDeadlineAt } })`, returns `'won'`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement the db**

```ts
import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../../../common/ids';
import { PrismaService } from '../../../prisma/prisma.service';

export type DueToClose = { auctionId: AuctionId; raceDate: Date };

export type CloseResult = 'already_closed' | 'no_sale' | 'won';

const CLOSABLE_STATUSES = ['SCHEDULED', 'OPEN'] as const;

@Injectable()
export class CloseAuctionsUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findDue(now: Date, after: AuctionId | null, limit: number): Promise<DueToClose[]> {
    const auctions = await this.prisma.auction.findMany({
      where: { status: { in: [...CLOSABLE_STATUSES] }, closeAt: { lte: now } },
      select: { id: true, raceEntry: { select: { raceDate: true } } },
      orderBy: { id: 'asc' },
      take: limit,
      ...(after === null ? {} : { cursor: { id: after }, skip: 1 }),
    });

    return auctions.map((auction) => ({
      auctionId: auction.id as AuctionId,
      raceDate: auction.raceEntry.raceDate,
    }));
  }

  // The status flip takes the auction row lock; the bid read must come after it so a concurrent bid either commits first or is rejected by the bidding ticket's own OPEN check.
  closeAuction(auctionId: AuctionId, now: Date, proofDeadlineAt: Date): Promise<CloseResult> {
    return this.prisma.$transaction(async (tx): Promise<CloseResult> => {
      const flipped = await tx.auction.updateMany({
        where: { id: auctionId, status: { in: [...CLOSABLE_STATUSES] }, closeAt: { lte: now } },
        data: { status: 'CLOSED' },
      });

      if (flipped.count === 0) {
        return 'already_closed';
      }

      const leading = await tx.bid.findFirst({ where: { auctionId, status: 'LEADING' } });

      if (!leading) {
        await tx.auction.update({ where: { id: auctionId }, data: { outcome: 'NO_SALE' } });

        return 'no_sale';
      }

      await tx.bid.update({ where: { id: leading.id }, data: { status: 'WON' } });
      await tx.bid.updateMany({
        where: { auctionId, id: { not: leading.id }, status: 'OUTBID' },
        data: { status: 'LOST' },
      });
      await tx.auction.update({
        where: { id: auctionId },
        data: { outcome: 'AWAITING_PROOF', proofDeadlineAt },
      });

      return 'won';
    });
  }
}
```

- [ ] **Step 4: Write the failing usecase spec.** Mock `CloseAuctionsUsecaseDb` only. Cases:
  - when `closeAuction` yields `'won'` for one auction and `'no_sale'` for another: returns `{ won: 1, noSale: 1 }`, and each call receives `proofDeadline(raceDate)` (assert the exact Date, e.g. race `2026-11-14T15:00:00Z` -> `2026-11-16T15:00:00Z`) and `now`.
  - when `'already_closed'`: counted in neither.
  - when `closeAuction` rejects: error logged, the next auction still processed, totals reflect only successes.
  - when the first page is full: second `findDue` call uses last auction id as `after`.

- [ ] **Step 5: Implement the usecase**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { proofDeadline } from '../../auction-window';
import { processInBatches } from '../../../auctions/process-in-batches';
import { CloseAuctionsUsecaseDb } from './close-auctions.usecase.db';

export type CloseTotals = { won: number; noSale: number };

@Injectable()
export class CloseAuctionsUsecase {
  private readonly logger = new Logger(CloseAuctionsUsecase.name);

  constructor(private readonly db: CloseAuctionsUsecaseDb) {}

  async execute(now: Date): Promise<CloseTotals> {
    const totals: CloseTotals = { won: 0, noSale: 0 };

    await processInBatches(
      (after, limit) => this.db.findDue(now, after, limit),
      (due) => due.auctionId,
      async (page) => {
        for (const due of page) {
          await this.close(due.auctionId, due.raceDate, now, totals);
        }
      },
    );

    return totals;
  }

  private async close(
    auctionId: Parameters<CloseAuctionsUsecaseDb['closeAuction']>[0],
    raceDate: Date,
    now: Date,
    totals: CloseTotals,
  ): Promise<void> {
    try {
      const result = await this.db.closeAuction(auctionId, now, proofDeadline(raceDate));

      if (result === 'won') {
        totals.won += 1;
      }

      if (result === 'no_sale') {
        totals.noSale += 1;
      }
    } catch (error) {
      this.logger.error(
        `Auction ${auctionId} failed to close: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

Replace the `Parameters<...>[0]` with a plain `AuctionId` import from `src/common/ids.ts` when writing it; it is shown that way only to avoid an unused-import in this snippet.

- [ ] **Step 6: Module** (`CloseAuctionsModule`: providers usecase + db, exports usecase).

- [ ] **Step 7: Run tests, gate, `git add src/auctions/usecases/close-auctions`.**

---

### Task 8: Service orchestration and module wiring

**Files:**
- Modify: `src/auctions/auction.service.ts`, `src/auctions/auction.service.spec.ts`, `src/auctions/auctions.module.ts`

**Interfaces:**
- Consumes: the three usecases (Tasks 5-7): `MaterializeAuctionsUsecase.execute(now): Promise<number>`, `OpenAuctionsUsecase.execute(now): Promise<number>`, `CloseAuctionsUsecase.execute(now): Promise<CloseTotals>`.
- Produces: `AuctionService.runLifecycleTick(now: Date): Promise<LifecycleTickResult>` with `LifecycleTickResult = { materialized: number; opened: number; closedWithWinner: number; closedNoSale: number }`. `AuctionService` keeps `getById`.

- [ ] **Step 1: Write the failing tests.** Extend `auction.service.spec.ts`: the testing module now also provides mock values for the three usecases. New `describe('runLifecycleTick')`:
  - when all phases succeed: returns `{ materialized: 9, opened: 9, closedWithWinner: 1, closedNoSale: 2 }` for stubbed values and passes the same `now` to each usecase.
  - when all phases succeed: call order is materialize, open, close (use `mock.invocationCallOrder`).
  - when the materialize usecase rejects: open and close still run, `materialized` is 0, error logged.
  - when the open usecase rejects: close still runs, `opened` is 0.
  - when the close usecase rejects: `closedWithWinner` and `closedNoSale` are 0.
  Keep the existing `getById` tests untouched (the `AuctionDb` provider stays).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Constructor gains `private readonly materializeAuctions: MaterializeAuctionsUsecase`, `openAuctions: OpenAuctionsUsecase`, `closeAuctions: CloseAuctionsUsecase`. Add:

```ts
  async runLifecycleTick(now: Date): Promise<LifecycleTickResult> {
    const materialized = await this.guarded('materialize', () => this.materializeAuctions.execute(now), 0);
    const opened = await this.guarded('open', () => this.openAuctions.execute(now), 0);
    const closed = await this.guarded('close', () => this.closeAuctions.execute(now), { won: 0, noSale: 0 });

    return {
      materialized,
      opened,
      closedWithWinner: closed.won,
      closedNoSale: closed.noSale,
    };
  }

  private async guarded<Result>(
    phase: string,
    run: () => Promise<Result>,
    fallback: Result,
  ): Promise<Result> {
    try {
      return await run();
    } catch (error) {
      this.logger.error(
        `Auction ${phase} phase failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return fallback;
    }
  }
```

Export the `LifecycleTickResult` type from `auction.service.ts`. `AuctionsModule`:

```ts
@Module({
  imports: [MaterializeAuctionsModule, OpenAuctionsModule, CloseAuctionsModule],
  providers: [AuctionService, AuctionDb],
  exports: [AuctionService],
})
export class AuctionsModule {}
```

(The task provider is added in Task 9.)

- [ ] **Step 4: Run tests, gate (`npm run build` verifies the module graph compiles; there must be no circular import between Auctions, Races and Zones), `git add src/auctions/auction.service.ts src/auctions/auction.service.spec.ts src/auctions/auctions.module.ts`.**

---

### Task 9: Scheduler task and app wiring

**Files:**
- Create: `src/auctions/auction-scheduler.task.ts`, `src/auctions/auction-scheduler.task.spec.ts`
- Modify: `src/auctions/auctions.module.ts`, `src/app.module.ts`

**Interfaces:**
- Consumes: `AuctionService.runLifecycleTick`; `ConfigService<EnvironmentVariables, true>` with `AUCTION_SCHEDULER_ENABLED`.
- Produces: `AuctionSchedulerTask.tick(): Promise<void>` decorated `@Interval(60_000)`.

- [ ] **Step 1: Write the failing test** (`auction-scheduler.task.spec.ts`)

```ts
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AuctionService } from './auction.service';
import { AuctionSchedulerTask } from './auction-scheduler.task';

const emptyResult = { materialized: 0, opened: 0, closedWithWinner: 0, closedNoSale: 0 };

describe('AuctionSchedulerTask', () => {
  let service: DeepMockProxy<AuctionService>;
  let config: DeepMockProxy<ConfigService>;
  let task: AuctionSchedulerTask;
  let log: MockInstance;
  let error: MockInstance;

  beforeEach(async () => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = mockDeep<AuctionService>();
    config = mockDeep<ConfigService>();
    config.get.mockReturnValue(true);
    service.runLifecycleTick.mockResolvedValue(emptyResult);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuctionSchedulerTask,
        { provide: AuctionService, useValue: service },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    task = moduleRef.get(AuctionSchedulerTask);
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
  });

  describe('when the scheduler is enabled', () => {
    it('runs a lifecycle tick', async () => {
      await task.tick();

      expect(service.runLifecycleTick).toHaveBeenCalledOnce();
    });
  });

  describe('when the scheduler is disabled', () => {
    beforeEach(() => {
      config.get.mockReturnValue(false);
    });

    it('does not run', async () => {
      await task.tick();

      expect(service.runLifecycleTick).not.toHaveBeenCalled();
    });
  });

  describe('when the previous tick is still running', () => {
    it('skips the overlapping tick', async () => {
      let release: () => void = () => undefined;
      service.runLifecycleTick.mockReturnValueOnce(
        new Promise((resolve) => {
          release = (): void => resolve(emptyResult);
        }),
      );

      const first = task.tick();
      await task.tick();
      release();
      await first;

      expect(service.runLifecycleTick).toHaveBeenCalledOnce();
    });
  });

  describe('when the tick changes something', () => {
    beforeEach(() => {
      service.runLifecycleTick.mockResolvedValue({ ...emptyResult, opened: 9 });
    });

    it('logs the counts', async () => {
      await task.tick();

      expect(log).toHaveBeenCalledWith(expect.stringContaining('opened=9'));
    });
  });

  describe('when the tick changes nothing', () => {
    it('stays quiet', async () => {
      await task.tick();

      expect(log).not.toHaveBeenCalled();
    });
  });

  describe('when the service throws', () => {
    beforeEach(() => {
      service.runLifecycleTick.mockRejectedValue(new Error('db down'));
    });

    it('swallows and logs the error', async () => {
      await expect(task.tick()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });

    it('allows the next tick to run', async () => {
      await task.tick();
      service.runLifecycleTick.mockResolvedValue(emptyResult);
      await task.tick();

      expect(service.runLifecycleTick).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** (`auction-scheduler.task.ts`)

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { EnvironmentVariables } from '../config/env.validation';
import { AuctionService } from './auction.service';

const TICK_INTERVAL_MILLIS = 60_000;

@Injectable()
export class AuctionSchedulerTask {
  private readonly logger = new Logger(AuctionSchedulerTask.name);
  private running = false;

  constructor(
    private readonly auctions: AuctionService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Interval(TICK_INTERVAL_MILLIS)
  async tick(): Promise<void> {
    if (!this.config.get('AUCTION_SCHEDULER_ENABLED', { infer: true }) || this.running) {
      return;
    }

    this.running = true;

    try {
      const result = await this.auctions.runLifecycleTick(new Date());
      const changed = Object.values(result).some((count) => count > 0);

      if (changed) {
        this.logger.log(
          `Auction tick: materialized=${result.materialized} opened=${result.opened} closedWithWinner=${result.closedWithWinner} closedNoSale=${result.closedNoSale}`,
        );
      }
    } catch (error) {
      this.logger.error(`Auction tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
```

The `running` field is intentionally mutable (not a constructor param). In the disabled test `config.get` is mocked to return `false` for any key; keep the mock key-agnostic.

- [ ] **Step 4: Wire.** Add `AuctionSchedulerTask` to `AuctionsModule.providers`. In `AppModule` add `ScheduleModule.forRoot()` (import from `@nestjs/schedule`) to `imports`.

- [ ] **Step 5: Run tests and the full gate;** `git add` the new and modified files. Confirm `npm run build` and that `dist` boots: `DATABASE_URL=... npm run start` shows no DI errors (needs the local Postgres and MinIO env from `.env.example`).

---

### Task 10: End-to-end verification against the real database (QA, no code)

**Files:** none (use a throwaway script or `psql`; do not commit seed scripts).

- [ ] **Step 1:** `docker compose up -d postgres minio`, `npx prisma migrate deploy`, start the app with `.env` (port 5435 may be held by another workspace; use a throwaway Postgres on another port if so).
- [ ] **Step 2: Materialize and open.** Create an athlete, a race with `date` about 11 days out in `America/Chicago`, a race entry with `verificationStatus = VERIFIED` and matching `race_local_date`, and save one floor (for example LEFT_PEC $25). Within about 60 s expect nine `auctions` rows. Because the race is 11 days out the window already opened, so expect all nine `OPEN`, LEFT_PEC `floor_price_cents = 2500`, the other eight `1000`, and `open_at`/`close_at` at Chicago local midnight of day -12 and -5.
- [ ] **Step 3: Gate checks.** A second entry left `PENDING` gets no rows; an entry for a banned athlete gets no rows; an entry whose race is 3 days out gets no rows.
- [ ] **Step 4: Close with winner.** Insert a bidder and two bids on one auction (older `OUTBID`, newer `LEADING`; set `current_leading_bid_id`). Set that auction's `close_at` to the past. Within about 60 s expect `status CLOSED`, `outcome AWAITING_PROOF`, `proof_deadline_at = race_date + 48h`, the leading bid `WON`, the other `LOST`.
- [ ] **Step 5: Close without bids.** Set another auction's `close_at` to the past: expect `CLOSED`, `outcome NO_SALE`, no proof deadline, `current_leading_bid_id` null. Set a never-opened `SCHEDULED` row's `close_at` past: expect `CLOSED` and `outcome NO_SALE`.
- [ ] **Step 6: Idempotency.** Run two app instances on different ports against the same DB for a few ticks, then re-count rows per `(race_entry_id, zone)` (must be 1) and confirm no row changed state twice (compare `updated_at` stability after the first tick).
- [ ] **Step 7:** Set `AUCTION_SCHEDULER_ENABLED=false`, restart, confirm no tick logs and no changes. Clean up the test data (note any test athlete left in the shared 5435 DB in the report, as earlier QA did).

---

## Self-review

- Spec coverage: 3.1 tick and guards -> T8, T9; 3.2 window math -> T1, T2; 3.3 materialize incl. late verification and skip when `closeAt` passed -> T5; 3.4 open with VERIFIED query filter, `assertVerified`, floor snapshot, CAS -> T6; 3.5 close incl. `SCHEDULED` never-opened, winner, `LOST`, no-sale, proof deadline -> T7; 3.7 config and wiring -> T3, T8, T9; 3.8 schema change -> T4; section 5 tests -> in each task plus T10; J1-J15 each map to a task (J1 T3/T9, J2 T5-T7 CAS, J3 T1-T2, J4 T5, J5 T5/T6, J6 T5, J7 T5/T6 filters, J8/J9/J10 T4 and T7, J11 T2/T5-T7, J12 T8, J13/J14 documentation only in the spec).
- Type consistency: `AuctionId` cursor in T6 and T7 matches `processInBatches<Item, Cursor>`; `RaceEntryId` cursor in T5; `LifecycleTickResult` fields identical in T8 and T9; `CloseTotals` `{ won, noSale }` mapped to `closedWithWinner`/`closedNoSale` in T8.
- Known loose end for the executor: T6 and T7 db/usecase specs are specified by exact assertions rather than full listings; follow T5's spec layout for harness code.
