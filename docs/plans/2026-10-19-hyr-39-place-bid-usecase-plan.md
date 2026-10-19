# HYR-39 Place-Bid Usecase Implementation Plan (HYR-9 slice B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `PlaceBidUsecase` (+ its own db) that places a bid inside one transaction holding `SELECT ... FOR UPDATE` on the auction row, enforces the HYR-9 rules with the HYR-38 increment helpers, and returns `previousLeader` as the HYR-11 seam. `BidService.placeBid` is a thin delegate. The `closeAt` check uses the database `now()` `now()` selected in the lock statement (`dbNow` in the snapshot; transaction-start semantics accepted, the lock-wait gap is ms), not an app clock.

**Architecture:** `BidService` -> `PlaceBidUsecase` -> `PlaceBidUsecaseDb`. The db owns the transaction and the lock and hands the usecase a locked-auction snapshot plus a transaction-bound `PlaceBidSession`; all rules live in the usecase, the db is the only ORM importer. Lock serializes with `CloseAuctionsUsecaseDb.closeAuction` (HYR-8) through the shared auction row lock; no change to the close job.

**Tech Stack:** NestJS 12, Prisma 6.19, Vitest 5 (globals), vitest-mock-extended, Postgres 16.

**Spec:** `docs/specs/2026-10-19-hyr-39-place-bid-usecase-design.md`. Builds on `docs/specs/2026-10-14-hyr-38-bid-increment-rules-design.md` (merged).

Size: about 700 lines total including tests. Fits one PR under the 800 cap; no ticket split. Backend-only, no frontend, no HTTP surface, no schema change. Branch `hyr-39` (already checked out). Tasks 1-3 are the shippable core (~480 lines); Tasks 4-5 (integration harness and specs, ~230 lines) stay in this PR (user decision); CI wiring is HYR-42.

Task order: 1 -> 2 -> 3 sequential (2 uses the types exported by 1; 3 wires 1 and 2). 4 -> 5 sequential and can start after Task 1 and 2 compile. 6 last.

## Global Constraints

- Explicit return types on every function/method (enforced by eslint); no single-letter variables (except `i/j/k` in indexed `for`); no inline `if` (braces, body on its own line); blank line before `if/for/while/return/throw` unless first in block; no `!!`; no commented-out code; no barrel files; numeric separators on literals of 5+ digits (`10_000`, `100_000_000`).
- Constructor parameter properties are `readonly`.
- Comments: none unless a genuinely non-obvious why, one or two lines (the lock-first ordering and demote-before-insert ordering each earn one).
- Branded types: `AuctionId`, `BidId`, `BidderId`, `Cents`, `NormalizedEmail`. Cast to a brand only in `*.usecase.db.ts`; use the validating constructors (`cents()`, `normalizeEmail()`) for values from the ORM where one exists. `BidId` has no constructor (HYR-38 decision): cast in the db.
- Errors: `DomainError` subclasses from `src/common/domain-error.ts` (`InvalidValueError`, `ForbiddenError`, `NotFoundError`, `ConflictError`; what the other usecases in this repo throw and what `DomainErrorFilter` maps), snake_case code only as message, `Logger.warn` with ids at each throw site. Never log the email.
- Vitest: nested `describe` per condition titled `when ...`/`if ...`; `it` titles state only the outcome; shared setup in that `describe`'s own `beforeEach`.
- No dependency changes (nothing new needed; if one is, pin exactly, no caret).
- Conventional Commits (lowercase imperative), end commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage for `/crit`; do NOT commit until the user approves.
- Linear HYR-39: move to In Progress when starting; In Review only once staged.
- Full check (run from `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/riyadh`): `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && npm run lint:arch`.

---

### Task 1: `PlaceBidUsecaseDb`

**Files:**
- Create: `src/bids/usecases/place-bid/place-bid.usecase.db.ts`
- Create: `src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts`

**Interfaces:**
- Produces: types `LockedAuction`, `LeadingBid`, `PlacedBid`, interface `PlaceBidSession`, class `PlaceBidUsecaseDb` with `withLockedAuction<T>(auctionId: AuctionId, work: (auction: LockedAuction, session: PlaceBidSession) => Promise<T>): Promise<T | null>`.

- [ ] **Step 1: Write the failing spec.** `place-bid.usecase.db.spec.ts`:

```ts
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import { cents } from '../../../common/money';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PlaceBidUsecaseDb, type PlaceBidSession } from './place-bid.usecase.db';

describe('PlaceBidUsecaseDb', () => {
  const auctionId = 'auction-1' as AuctionId;
  const closeAt = new Date('2026-11-09T06:00:00Z');
  const dbNow = new Date('2026-11-08T12:00:00Z');
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<PrismaService>;
  let db: PlaceBidUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(((callback: (client: unknown) => unknown) => callback(tx)) as never);
    db = new PlaceBidUsecaseDb(prisma);
  });

  describe('withLockedAuction', () => {
    describe('when the auction does not exist', () => {
      beforeEach(() => {
        tx.$queryRaw.mockResolvedValue([] as never);
      });

      it('returns null without running the work', async () => {
        const work = vi.fn();

        const result = await db.withLockedAuction(auctionId, work);

        expect(result).toBeNull();
        expect(work).not.toHaveBeenCalled();
        expect(tx.auction.findUniqueOrThrow).not.toHaveBeenCalled();
      });
    });

    describe('when the auction exists', () => {
      beforeEach(() => {
        tx.$queryRaw
          .mockResolvedValueOnce([{ id: 'auction-1', db_now: dbNow }] as never);
        tx.auction.findUniqueOrThrow.mockResolvedValue({
          status: 'OPEN',
          closeAt,
          floorPriceCents: 1000,
          raceEntry: { athlete: { email: 'athlete@example.com', isBanned: false } },
        } as never);
      });

      it('locks the row with FOR UPDATE before reading it', async () => {
        await db.withLockedAuction(auctionId, async () => 'done');

        const [strings] = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];

        expect(strings.join('?')).toContain('FOR UPDATE');
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          tx.auction.findUniqueOrThrow.mock.invocationCallOrder[0],
        );
      });

      it('reads the database time in the lock statement', async () => {
        await db.withLockedAuction(auctionId, async () => 'done');

        const [strings] = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];

        expect(strings.join('?')).toContain('now() AS "db_now"');
        expect(tx.$queryRaw.mock.calls).toHaveLength(1);
      });

      it('runs the work in a transaction with a timeout', async () => {
        await db.withLockedAuction(auctionId, async () => 'done');

        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 10_000 });
      });

      it('passes the branded snapshot and returns the work result', async () => {
        const work = vi.fn().mockResolvedValue('done');

        const result = await db.withLockedAuction(auctionId, work);

        expect(result).toBe('done');
        expect(work).toHaveBeenCalledWith(
          {
            status: 'OPEN',
            closeAt,
            dbNow,
            floorPriceCents: 1000,
            athleteEmail: 'athlete@example.com',
            athleteBanned: false,
          },
          expect.any(Object),
        );
      });
    });
  });

  describe('session', () => {
    let session: PlaceBidSession;

    beforeEach(async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: 'auction-1', db_now: dbNow }] as never);
      tx.auction.findUniqueOrThrow.mockResolvedValue({
        status: 'OPEN',
        closeAt,
        floorPriceCents: 1000,
        raceEntry: { athlete: { email: 'athlete@example.com', isBanned: false } },
      } as never);
      await db.withLockedAuction(auctionId, async (_auction, boundSession) => {
        session = boundSession;
      });
    });

    describe('upsertBidder', () => {
      it('upserts by email and returns the bidder id', async () => {
        tx.bidder.upsert.mockResolvedValue({ id: 'bidder-1' } as never);

        const result = await session.upsertBidder('brand@example.com' as NormalizedEmail);

        expect(result).toBe('bidder-1');
        expect(tx.bidder.upsert).toHaveBeenCalledWith({
          where: { email: 'brand@example.com' },
          create: { email: 'brand@example.com' },
          update: {},
        });
      });
    });

    describe('findLeading', () => {
      describe('when there is a leading bid', () => {
        it('returns it with a validated amount', async () => {
          tx.bid.findFirst.mockResolvedValue({ id: 'bid-1', bidderId: 'bidder-1', amountCents: 5000 } as never);

          const result = await session.findLeading();

          expect(result).toEqual({ id: 'bid-1', bidderId: 'bidder-1', amountCents: 5000 });
          expect(tx.bid.findFirst).toHaveBeenCalledWith({ where: { auctionId, status: 'LEADING' } });
        });
      });

      describe('when there is no leading bid', () => {
        it('returns null', async () => {
          tx.bid.findFirst.mockResolvedValue(null);

          expect(await session.findLeading()).toBeNull();
        });
      });
    });

    describe('markOutbid', () => {
      it('sets the bid status to OUTBID', async () => {
        await session.markOutbid('bid-1' as BidId);

        expect(tx.bid.update).toHaveBeenCalledWith({ where: { id: 'bid-1' }, data: { status: 'OUTBID' } });
      });
    });

    describe('insertLeading', () => {
      const placedAt = new Date('2026-11-08T10:00:00Z');

      beforeEach(() => {
        tx.bid.create.mockResolvedValue({
          id: 'bid-2',
          auctionId: 'auction-1',
          bidderId: 'bidder-2',
          amountCents: 5500,
          placedAt,
        } as never);
      });

      it('creates a LEADING bid and points the auction at it', async () => {
        const result = await session.insertLeading('bidder-2' as BidderId, cents(5500));

        expect(tx.bid.create).toHaveBeenCalledWith({
          data: { auctionId, bidderId: 'bidder-2', amountCents: 5500, status: 'LEADING' },
        });
        expect(tx.auction.update).toHaveBeenCalledWith({
          where: { id: auctionId },
          data: { currentLeadingBidId: 'bid-2' },
        });
        expect(result).toEqual({
          id: 'bid-2',
          auctionId: 'auction-1',
          bidderId: 'bidder-2',
          amountCents: 5500,
          placedAt,
        });
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts` -> FAIL, module not found.

- [ ] **Step 3: Implement** `place-bid.usecase.db.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeEmail, type NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import { cents, type Cents } from '../../../common/money';
import { PrismaService } from '../../../prisma/prisma.service';

const TRANSACTION_TIMEOUT_MS = 10_000;

export type LockedAuction = {
  status: 'SCHEDULED' | 'OPEN' | 'CLOSED';
  closeAt: Date;
  dbNow: Date;
  floorPriceCents: Cents;
  athleteEmail: NormalizedEmail;
  athleteBanned: boolean;
};

export type LeadingBid = { id: BidId; bidderId: BidderId; amountCents: Cents };

export type PlacedBid = {
  id: BidId;
  auctionId: AuctionId;
  bidderId: BidderId;
  amountCents: Cents;
  placedAt: Date;
};

export interface PlaceBidSession {
  upsertBidder(email: NormalizedEmail): Promise<BidderId>;
  findLeading(): Promise<LeadingBid | null>;
  markOutbid(bidId: BidId): Promise<void>;
  insertLeading(bidderId: BidderId, amountCents: Cents): Promise<PlacedBid>;
}

@Injectable()
export class PlaceBidUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  withLockedAuction<T>(
    auctionId: AuctionId,
    work: (auction: LockedAuction, session: PlaceBidSession) => Promise<T>,
  ): Promise<T | null> {
    return this.prisma.$transaction(
      async (tx): Promise<T | null> => {
        // Must be the first statement: later reads then see everything committed before the lock was granted.
        const locked = await tx.$queryRaw<Array<{ id: string; db_now: Date }>>`
          SELECT "id", now() AS "db_now" FROM "auctions" WHERE "id" = ${auctionId} FOR UPDATE
        `;

        if (locked.length === 0) {
          return null;
        }

        const auction = await tx.auction.findUniqueOrThrow({
          where: { id: auctionId },
          select: {
            status: true,
            closeAt: true,
            floorPriceCents: true,
            raceEntry: { select: { athlete: { select: { email: true, isBanned: true } } } },
          },
        });

        return work(
          {
            status: auction.status,
            closeAt: auction.closeAt,
            dbNow: locked[0].db_now,
            floorPriceCents: cents(auction.floorPriceCents),
            athleteEmail: normalizeEmail(auction.raceEntry.athlete.email),
            athleteBanned: auction.raceEntry.athlete.isBanned,
          },
          this.sessionFor(tx, auctionId),
        );
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  private sessionFor(tx: Prisma.TransactionClient, auctionId: AuctionId): PlaceBidSession {
    return {
      upsertBidder: async (email): Promise<BidderId> => {
        const bidder = await tx.bidder.upsert({ where: { email }, create: { email }, update: {} });

        return bidder.id as BidderId;
      },
      findLeading: async (): Promise<LeadingBid | null> => {
        const leading = await tx.bid.findFirst({ where: { auctionId, status: 'LEADING' } });

        if (!leading) {
          return null;
        }

        return {
          id: leading.id as BidId,
          bidderId: leading.bidderId as BidderId,
          amountCents: cents(leading.amountCents),
        };
      },
      markOutbid: async (bidId): Promise<void> => {
        await tx.bid.update({ where: { id: bidId }, data: { status: 'OUTBID' } });
      },
      insertLeading: async (bidderId, amountCents): Promise<PlacedBid> => {
        const bid = await tx.bid.create({ data: { auctionId, bidderId, amountCents, status: 'LEADING' } });

        await tx.auction.update({ where: { id: auctionId }, data: { currentLeadingBidId: bid.id } });

        return {
          id: bid.id as BidId,
          auctionId,
          bidderId,
          amountCents,
          placedAt: bid.placedAt,
        };
      },
    };
  }
}
```

If `normalizeEmail` throws on a legacy athlete email the bid fails with 400 `email_invalid`; athlete signup already validates, so accept.

- [ ] **Step 4: Run to verify pass.** Same command -> PASS. Adjust only the spec's mock plumbing if types complain; do not change production code to suit mocks.

- [ ] **Step 5: Stage.** `git add src/bids/usecases/place-bid/place-bid.usecase.db.ts src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts`

---

### Task 2: `PlaceBidUsecase`

**Files:**
- Create: `src/bids/usecases/place-bid/place-bid.usecase.ts`
- Create: `src/bids/usecases/place-bid/place-bid.usecase.spec.ts`

**Interfaces:**
- Consumes: Task 1 types; `minimumNextBidCents`, `MAX_BID_CENTS` from `src/bids/bid-increment.ts`.
- Produces: `PlaceBidInput`, `PreviousLeader`, `PlaceBidResult`, `PlaceBidUsecase.execute(input: PlaceBidInput): Promise<PlaceBidResult>`.

- [ ] **Step 1: Write the failing spec.** `place-bid.usecase.spec.ts`. Setup: `db = mockDeep<PlaceBidUsecaseDb>()`, `session = mock<PlaceBidSession>()` (from `vitest-mock-extended`), `db.withLockedAuction.mockImplementation(((_id: AuctionId, work: (a: LockedAuction, s: PlaceBidSession) => Promise<unknown>) => work(auction, session)) as never)`, spy `Logger.prototype.warn` (restore in `afterEach`). Fixtures: default `auction = { status: 'OPEN', dbNow: 2026-11-08T12:00:00Z, closeAt: 2026-11-09T06:00:00Z, floorPriceCents: cents(1000), athleteEmail: 'athlete@example.com', athleteBanned: false }`; `session.upsertBidder` resolves `'bidder-2'`; `session.findLeading` resolves `null`; `session.insertLeading` resolves a `PlacedBid` echoing bidder/amount. Helper `input(overrides)` returns `{ auctionId, email: 'brand@example.com', amountCents: cents(1000) }`. Assertions use `await expect(usecase.execute(...)).rejects.toThrow(new ConflictError('auction_not_open'))` style. Cases, each a `describe` with `beforeEach` where setup differs:

```
when the amount is above the maximum        -> rejects InvalidValueError('bid_above_maximum'); db.withLockedAuction not called
when the auction does not exist             -> withLockedAuction resolves null -> rejects NotFoundError('auction_not_found')
when the auction is SCHEDULED               -> ConflictError('auction_not_open')
when the auction is CLOSED                  -> ConflictError('auction_not_open')
when closeAt equals dbNow                   -> ConflictError('auction_not_open')
when closeAt is before dbNow                -> ConflictError('auction_not_open')
when the seller is banned                   -> ConflictError('auction_not_open')
when the bidder email is the athlete email  -> ForbiddenError('self_bid_not_allowed'); upsertBidder not called
when the bidder already leads               -> findLeading returns leader with bidderId 'bidder-2' and amount 5000; bid 9000 -> ConflictError('already_leading'); same with amount below minimum
when there is no leading bid:
  bid below the floor (999)                 -> InvalidValueError('bid_below_minimum'); markOutbid/insertLeading not called
  bid equal to the floor (1000)             -> resolves; previousLeader null; markOutbid not called
  bid above the floor                       -> resolves
when another bidder leads under $100 (leader 5000, id bid-1, bidder 'bidder-1'):
  bid equal to leader (5000)                -> bid_below_minimum
  bid 5499                                  -> bid_below_minimum
  bid 5500                                  -> resolves; previousLeader { bidId 'bid-1', bidderId 'bidder-1', amountCents 5000 }; markOutbid('bid-1') invoked before insertLeading (compare invocationCallOrder)
when another bidder leads above $100 (leader 10_100):
  bid 10_604 -> bid_below_minimum; bid 10_605 -> resolves
when a rule rejects the bid                 -> insertLeading and markOutbid never called (one assertion per rejecting describe above is enough: add to a shared afterEach-free check in the self-bid, already-leading and below-minimum describes)
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.spec.ts` -> FAIL, module not found.

- [ ] **Step 3: Implement** `place-bid.usecase.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, ForbiddenError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { MAX_BID_CENTS, minimumNextBidCents } from '../../bid-increment';
import {
  PlaceBidUsecaseDb,
  type LockedAuction,
  type PlaceBidSession,
  type PlacedBid,
} from './place-bid.usecase.db';

export type PlaceBidInput = { auctionId: AuctionId; email: NormalizedEmail; amountCents: Cents };

export type PreviousLeader = { bidId: BidId; bidderId: BidderId; amountCents: Cents };

export type PlaceBidResult = { bid: PlacedBid; previousLeader: PreviousLeader | null };

@Injectable()
export class PlaceBidUsecase {
  private readonly logger = new Logger(PlaceBidUsecase.name);

  constructor(private readonly db: PlaceBidUsecaseDb) {}

  async execute(input: PlaceBidInput): Promise<PlaceBidResult> {
    if (input.amountCents > MAX_BID_CENTS) {
      this.logger.warn(`Bid of ${input.amountCents} cents on auction ${input.auctionId} exceeds the maximum`);

      throw new InvalidValueError('bid_above_maximum');
    }

    const result = await this.db.withLockedAuction(input.auctionId, (auction, session) =>
      this.place(input, auction, session),
    );

    if (!result) {
      this.logger.warn(`Auction ${input.auctionId} not found`);

      throw new NotFoundError('auction_not_found');
    }

    return result;
  }

  private async place(
    input: PlaceBidInput,
    auction: LockedAuction,
    session: PlaceBidSession,
  ): Promise<PlaceBidResult> {
    this.assertOpen(input.auctionId, auction);

    if (input.email === auction.athleteEmail) {
      this.logger.warn(`Self-bid refused on auction ${input.auctionId}`);

      throw new ForbiddenError('self_bid_not_allowed');
    }

    const bidderId = await session.upsertBidder(input.email);
    const leading = await session.findLeading();

    if (leading && leading.bidderId === bidderId) {
      this.logger.warn(`Bidder ${bidderId} already leads auction ${input.auctionId}`);

      throw new ConflictError('already_leading');
    }

    const minimum = minimumNextBidCents(leading ? leading.amountCents : null, auction.floorPriceCents);

    if (input.amountCents < minimum) {
      this.logger.warn(
        `Bid of ${input.amountCents} cents on auction ${input.auctionId} is below the minimum of ${minimum}`,
      );

      throw new InvalidValueError('bid_below_minimum');
    }

    if (leading) {
      // The partial unique index allows one LEADING bid per auction, so demote before inserting.
      await session.markOutbid(leading.id);
    }

    const bid = await session.insertLeading(bidderId, input.amountCents);

    return {
      bid,
      previousLeader: leading ? { bidId: leading.id, bidderId: leading.bidderId, amountCents: leading.amountCents } : null,
    };
  }

  private assertOpen(auctionId: AuctionId, auction: LockedAuction): void {
    if (auction.status !== 'OPEN') {
      this.logger.warn(`Auction ${auctionId} is ${auction.status}, not open for bids`);

      throw new ConflictError('auction_not_open');
    }

    if (auction.closeAt <= auction.dbNow) {
      this.logger.warn(`Auction ${auctionId} closed at ${auction.closeAt.toISOString()}`);

      throw new ConflictError('auction_not_open');
    }

    if (auction.athleteBanned) {
      this.logger.warn(`Auction ${auctionId} refused: seller is banned`);

      throw new ConflictError('auction_not_open');
    }
  }
}
```

- [ ] **Step 4: Run to verify pass.** Same command -> PASS.

- [ ] **Step 5: Stage.** `git add src/bids/usecases/place-bid/place-bid.usecase.ts src/bids/usecases/place-bid/place-bid.usecase.spec.ts`

---

### Task 3: Module, service delegate, wiring

**Files:**
- Create: `src/bids/usecases/place-bid/place-bid.module.ts`
- Modify: `src/bids/bid.service.ts`, `src/bids/bids.module.ts`, `src/bids/bid.service.spec.ts`

- [ ] **Step 1: Failing test.** In `bid.service.spec.ts` add `{ provide: PlaceBidUsecase, useValue: usecase }` (`usecase = mockDeep<PlaceBidUsecase>()`) to the testing module, and a new block:

```ts
describe('placeBid', () => {
  const input: PlaceBidInput = {
    auctionId: 'auction-1' as AuctionId,
    email: 'brand@example.com' as NormalizedEmail,
    amountCents: cents(5500),
  };

  it('delegates to the usecase and returns its result', async () => {
    const result = { bid: { id: 'bid-1' }, previousLeader: null };
    usecase.execute.mockResolvedValue(result as never);

    const actual = await service.placeBid(input);

    expect(actual).toBe(result);
    expect(usecase.execute).toHaveBeenCalledWith(input);
  });
});
```

Run `npx vitest run src/bids/bid.service.spec.ts` -> FAIL.

- [ ] **Step 2: Implement.**

`place-bid.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PlaceBidUsecase } from './place-bid.usecase';
import { PlaceBidUsecaseDb } from './place-bid.usecase.db';

@Module({
  providers: [PlaceBidUsecase, PlaceBidUsecaseDb],
  exports: [PlaceBidUsecase],
})
export class PlaceBidModule {}
```

`bid.service.ts`: inject `private readonly placeBidUsecase: PlaceBidUsecase` as a second readonly constructor param, add

```ts
placeBid(input: PlaceBidInput): Promise<PlaceBidResult> {
  return this.placeBidUsecase.execute(input);
}
```

`bids.module.ts`: add `imports: [PlaceBidModule]`.

- [ ] **Step 3: Run** `npx vitest run src/bids` -> PASS. Then `npx tsc --noEmit -p tsconfig.json` and `npm run lint:arch` (the usecase and service files must not trip `no-orm-outside-db-layer`).

- [ ] **Step 4: Stage** the four files.

---

### Task 4: Integration test infrastructure

**Files:**
- Modify: `vitest.config.ts`, `package.json` (scripts only)
- Create: `vitest.integration.config.ts`
- Create: `src/testing/throwaway-database.ts`

- [ ] **Step 1: Default config excludes integration specs.** `vitest.config.ts`: add `exclude: ['**/node_modules/**', 'src/**/*.int.spec.ts']` under `test` (keep `include`).

- [ ] **Step 2: Integration config** `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.int.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
```

`package.json` scripts: add `"test:integration": "vitest run --config vitest.integration.config.ts"` (no dependency changes).

- [ ] **Step 3: Helper** `src/testing/throwaway-database.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://hyrox:hyrox@localhost:5435/postgres';

export type ThrowawayDatabase = { prisma: PrismaService; drop: () => Promise<void> };

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);

  url.pathname = `/${name}`;
  url.searchParams.set('connection_limit', '20');

  return url.toString();
}

export async function isPostgresReachable(adminUrl: string): Promise<boolean> {
  const admin = new PrismaClient({ datasourceUrl: adminUrl });

  try {
    await admin.$queryRaw`SELECT 1`;

    return true;
  } catch {
    return false;
  } finally {
    await admin.$disconnect();
  }
}

export async function createThrowawayDatabase(adminUrl: string): Promise<ThrowawayDatabase> {
  const name = `hyrox_it_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = new PrismaClient({ datasourceUrl: adminUrl });

  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);

  const url = databaseUrl(adminUrl, name);

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const previousUrl = process.env.DATABASE_URL;

  process.env.DATABASE_URL = url;

  const prisma = new PrismaService();

  await prisma.onModuleInit();

  return {
    prisma,
    drop: async (): Promise<void> => {
      await prisma.onModuleDestroy();
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      process.env.DATABASE_URL = previousUrl;
    },
  };
}
```

`name` is generated locally (hex only), never user input, so `$executeRawUnsafe` is safe here. If `previousUrl` is `undefined`, restoring by assignment would set the string `'undefined'`: use `delete process.env.DATABASE_URL` in that case (implement with an `if`).

- [ ] **Step 4: Smoke-check the helper.** Make sure Postgres is up: `docker ps --format '{{.Names}} {{.Ports}}'` and look for `5435->5432`. If another workspace's compose project already owns 5435, reuse it. Only if nothing listens, `docker compose up -d postgres` from this repo. Never use the `hyrox_sponsor` database for these tests. Then run `npm run test:integration` after Task 5; before that, `npx tsc --noEmit -p tsconfig.json` and `npm run lint` must pass.

- [ ] **Step 5: Stage** the four files.

---

### Task 5: Concurrency integration spec

**Files:**
- Create: `src/bids/usecases/place-bid/place-bid.usecase.int.spec.ts`

**Interfaces:** real `PlaceBidUsecase(new PlaceBidUsecaseDb(prisma))` and real `CloseAuctionsUsecaseDb(prisma)`.

- [ ] **Step 1: Write the spec.**

Harness:
- `const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL; const reachable = await isPostgresReachable(adminUrl);` at module top; `describe.skipIf(!reachable)('PlaceBidUsecase (postgres)', ...)`.
- `beforeAll`: `createThrowawayDatabase(adminUrl)`; build usecase and close db. `afterAll`: `drop()`.
- `seedAuction(prisma, { closeAt, status = 'OPEN', floorPriceCents = 1000, banned = false })` returns `{ auctionId, athleteEmail }`: creates `Athlete` (`name`, unique `email` `athlete-<random>@example.com`, `passwordHash: 'x'`, `isBanned`), `Race` (`name`, random `nameKey`, `date`, `timezone: 'America/Chicago'`, `location`), `RaceEntry` (`athleteId`, `raceId`, `division: 'SINGLE_OPEN_MEN'`, `verificationStatus: 'VERIFIED'`, `raceDate`, `raceLocalDate`), `Auction` (`raceEntryId`, `zone: 'LEFT_PEC'`, `floorPriceCents`, `openAt`, `closeAt`, `status`). Use a random suffix (`randomUUID().slice(0, 8)`) for uniqueness.
- `bidAs(auctionId, emailLocalPart, amount)` builds `PlaceBidInput` with `normalizeEmail(...)` and `cents(...)`; default `closeAt` for seeded auctions is one day from now.
- `snapshot(auctionId)` returns bids ordered by `placedAt` and the auction row.

Scenarios (each a `describe` with a short `it` list; names state the outcome):

1. `when six bidders race the same valid amount`: `Promise.allSettled` over six `bidAs(auctionId, 'bidder-i', 1500)`. Expect exactly 1 fulfilled; the 5 rejections are `InvalidValueError` with code `bid_below_minimum` (first bid at/above floor wins, the rest are below leader + $5); one `LEADING` row in `bids`; `auction.currentLeadingBidId` equals its id.
2. `when bidders race with ascending distinct amounts`: amounts 1000 + 600 * i for i = 0..5, shuffled start order via `Promise.allSettled`. Expect: exactly one LEADING row whose amount is the maximum among fulfilled results; every other fulfilled bid is `OUTBID`; sorted by `placedAt` the accepted amounts strictly increase and each step is at least `minimumNextBidCents(previous, floor)`; `currentLeadingBidId` matches the LEADING bid; every rejection is `bid_below_minimum`.
3. `when the same bidder fires twice at once`: two `bidAs(auctionId, 'same', 1500)` -> one fulfilled, one `ConflictError('already_leading')`; one bidder row for that email.
4. `when a rejected bid would have created a new bidder`: self-bid with the athlete's email is rejected and `bidder` count for that email stays 0; a below-floor bid from a fresh email is rejected and creates no bidder row (transaction rolled back).
5. `when the lock is held by another transaction`: open `prisma.$transaction(async (tx) => { await tx.$queryRaw\`SELECT "id" FROM "auctions" WHERE "id" = ${auctionId} FOR UPDATE\`; ...hold...})` controlled with a manually resolved promise (`let release`); start `bidAs(...)`; `await new Promise((resolve) => setTimeout(resolve, 300))` and assert the bid promise is still pending (track with a `settled` flag set in `.finally`); inside the held transaction `tx.auction.update({ data: { status: 'CLOSED' } })`, then release/commit; the bid rejects with `ConflictError('auction_not_open')` and no bid row exists.
6. `when a bid races the close job` (loop 25 iterations, fresh auction each, `closeAt = new Date(Date.now() + 10 + iteration * 4)` so the bid's database clock lands on both sides of `closeAt` across iterations; start the bid and `closeDb.closeAuction(auctionId, closeAt, proofDeadline)` concurrently via `Promise.allSettled`, the close job given `now = closeAt` so its predicate is satisfied regardless of the real clock): afterwards read the auction. If the bid fulfilled: its row is `WON`, `outcome = AWAITING_PROOF`. If it rejected (`auction_not_open`, whether from the clock or the status): `outcome = NO_SALE` and zero bids. In every iteration `status = CLOSED` and no bid is left `LEADING`. Assert only these invariants (do not assert both orders were seen).
7. `when the seller is banned` (one case): rejects `auction_not_open` against the real schema.

- [ ] **Step 2: Run** `npm run test:integration`. Expected: PASS against Postgres on 5435; with no Postgres, the suite is skipped and the command exits 0. If migrations fail on a dirty DB: the helper only ever creates a fresh database, so a failure is real, investigate. If the run hangs, check for leaked `hyrox_it_*` databases (`docker exec <container> psql -U hyrox -c '\l'`) and drop them.

- [ ] **Step 3: Sanity-check the test has teeth (do not commit).** Temporarily remove `FOR UPDATE` from the lock query and run scenarios 1, 2, 5 and 6; at least 1/2 and 5 must fail (and likely 6). Restore the query. Report in the handoff that this was done.

- [ ] **Step 4: Stage** the spec file.

---

### Task 6: Full verification (qa-verifier) and handoff

- [ ] Run the full check: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && npm run lint:arch`, then `npm run test:integration`, then `npm run build` (confirm `*.int.spec.ts` is excluded by `tsconfig.build.json`'s `**/*spec.ts` and `src/testing/throwaway-database.ts` is acceptable in the build; if it is not wanted in `dist`, add `src/testing` to the build `exclude`).
- [ ] Confirm `git status` shows only the intended files staged, `git diff --cached --stat` is under about 800 lines, and no `Co-Authored-By` or lint violations are pending.
- [ ] Move HYR-39 to In Review only once staged. Tell the user it is staged and ready for `/crit`; do not commit until they approve. Suggested commit title: `feat(bids): add place-bid usecase with row-locked leader handling`.

## Self-review notes

- Spec coverage: rules 0-8 map to Task 2; lock, snapshot and session map to Task 1; delegate to Task 3; concurrency approach to Tasks 4-5; the HYR-8 serialization is proven by scenarios 5 and 6.
- No schema change, no HTTP surface, no dependency change.
- Follow-up (already ticketed): wiring `test:integration` into CI is HYR-42. `bid_below_minimum` stays 400. No other follow-ups.
