# HYR-39: Place-Bid Usecase with Row-Locked Highest-Bid Handling (HYR-9 slice B) - Design Spec

Status: PROPOSED. The ticket text fixed most rules; the remaining open points were resolved by planner judgment (no interactive Q&A available) and are listed in section 9 for confirmation.
Ticket: HYR-39, slice B of epic HYR-9 "Bid placement + increment validation ($5 flat under $100, 5% above)".
Plan: `docs/plans/2026-10-19-hyr-39-place-bid-usecase-plan.md`.
Date: 2026-10-19
Depends on: HYR-38 (merged, b79b5bb: `minimumNextBidCents`, `MAX_BID_CENTS`, `auctionId`, `bidderId`, `ceilPercentOfCents`) and HYR-8 (merged: auction lifecycle, `CloseAuctionsUsecaseDb`). Blocks: HYR-40 (HTTP endpoint), HYR-11 (Stripe hold).
Note: the epic umbrella spec (`docs/specs/2026-10-14-bid-placement-design.md`) is not present in this worktree; this spec is derived from the ticket text, the HYR-38 spec and the repo, and was not cross-checked against the umbrella.

## 1. Context

Auctions are opened and closed by the HYR-8 scheduler. Nothing writes `Bid` rows yet. `BidDb` only reads the leading bid; `BidService` only exposes `getLeadingBid`. The schema already has what is needed: `Auction.currentLeadingBidId` (unique FK), `Bid.status` (`LEADING/OUTBID/...`), and a hand-written partial unique index `bid_one_leading_per_auction` on `bids(auction_id) WHERE status = 'LEADING'` (init migration). This slice adds the write path with correct concurrency and no schema change.

Two writers touch the same auction: bidders (this slice) and the close job (`CloseAuctionsUsecaseDb.closeAuction`, which flips status with a compare-and-set `updateMany`, then reads the LEADING bid). They must serialize.

## 2. Scope

In:
- `PlaceBidUsecase` + `PlaceBidUsecaseDb` + `PlaceBidModule` under `src/bids/usecases/place-bid/`.
- `BidService.placeBid` as a thin delegate; `BidsModule` imports `PlaceBidModule`.
- Unit specs for usecase and db; integration specs against real Postgres for concurrency (section 7).
- Vitest integration config + throwaway-database helper (test infra only).

Out:
- HTTP surface, DTOs, rate limiting, error-code to status table for clients (HYR-40).
- Stripe hold on the new leader / void of the previous leader (HYR-11). This slice only returns `previousLeader` as the seam.
- Schema or migration changes. Anti-sniping extension (epic decision: none). Notifications to the outbid bidder.
- Withdrawing bids, `BidService.getLeadingBid` changes.

## 3. Approaches considered

Locking:
- A. `SELECT ... FOR UPDATE` on the auction row inside one interactive transaction (chosen, ticket requirement). Pessimistic, tiny critical section, and it blocks/queues the close job's `updateMany` on the same row, which gives the serialization HYR-8 needs for free.
- B. Optimistic compare-and-set on `currentLeadingBidId` with retry. No lock but needs retry loops and does not by itself order against the close job. Rejected.
- C. Serializable isolation. Heavier, retries on serialization failure, no benefit over A. Rejected.

Splitting business logic from ORM in one transaction (the usecase must hold the rules, only the db may import Prisma):
- A. Db exposes `withLockedAuction(auctionId, work)`: opens the transaction, takes the lock, loads the locked auction snapshot, then runs the usecase's `work(auction, session)` callback; `session` is a small interface of narrow queries bound to the transaction client (chosen). Rules stay in the usecase and are unit-testable with a fake session; throwing from `work` rolls back.
- B. Put all rules in one db method (as `closeAuction` does). Mixes business rules into the ORM file, violating the repo split for a rule-heavy operation. Rejected.
- C. Pass the Prisma tx client into the usecase. Leaks the ORM into the usecase. Rejected.

## 4. Design

### 4.1 Files

New, under `src/bids/usecases/place-bid/`:
- `place-bid.usecase.ts`: rules and orchestration, no ORM import, `Logger`.
- `place-bid.usecase.db.ts`: only ORM importer; `withLockedAuction` and the transaction-bound session.
- `place-bid.module.ts`: providers `[PlaceBidUsecase, PlaceBidUsecaseDb]`, exports `PlaceBidUsecase`.
- specs, plus `place-bid.usecase.int.spec.ts` (integration).

Modified: `src/bids/bid.service.ts` (+`placeBid`), `src/bids/bids.module.ts` (imports `PlaceBidModule`), `src/bids/bid.service.spec.ts`.
Test infra: `vitest.config.ts` (exclude `*.int.spec.ts`), new `vitest.integration.config.ts`, `src/testing/throwaway-database.ts`, `package.json` script `test:integration`.

Call direction: `BidService` -> `PlaceBidUsecase` -> `PlaceBidUsecaseDb`. The usecase never calls back into the service. The usecase has its own narrow db (the general `BidDb` is not used), a full physical split with no shared-class shortcut.

### 4.2 Contract

```ts
export type PlaceBidInput = { auctionId: AuctionId; email: NormalizedEmail; amountCents: Cents };

export type PreviousLeader = { bidId: BidId; bidderId: BidderId; amountCents: Cents };

export type PlaceBidResult = {
  bid: { id: BidId; auctionId: AuctionId; bidderId: BidderId; amountCents: Cents; placedAt: Date };
  previousLeader: PreviousLeader | null;
};

BidService.placeBid(input: PlaceBidInput): Promise<PlaceBidResult>
PlaceBidUsecase.execute(input: PlaceBidInput): Promise<PlaceBidResult>
```

The caller (HYR-40) normalizes the email with `normalizeEmail` and builds `Cents` with `cents()`; the usecase takes the branded values, so a bad email or non-integer amount fails at the boundary as `email_invalid` / `cents_invalid` (400) before any DB work. There is no `now` parameter: the time used for the close check is the database `now()`, returned by the lock statement (section 4.5). Tests control it through the fake snapshot's `dbNow`.

### 4.3 Db: `withLockedAuction`

```ts
withLockedAuction<T>(
  auctionId: AuctionId,
  work: (auction: LockedAuction, session: PlaceBidSession) => Promise<T>,
): Promise<T | null>   // null when the auction does not exist
```

Inside `prisma.$transaction(callback, { timeout: 10_000 })`:
1. `tx.$queryRaw` `SELECT "id", now() AS "db_now" FROM "auctions" WHERE "id" = ${auctionId} FOR UPDATE` (parameterized tagged template, no string building). Zero rows -> return `null`. This must be the first statement: Postgres READ COMMITTED then gives every later statement in the transaction a snapshot taken after the lock was granted, so they see the winner of any prior contender. `db_now` becomes `dbNow` in the snapshot.
2. `tx.auction.findUniqueOrThrow` selecting `status`, `closeAt`, `floorPriceCents`, and `raceEntry.athlete { email, isBanned }`. The lock is on the auction row only; athlete rows are not locked (no deadlock surface with other flows).
3. Return `work(lockedAuction, session)`.

```ts
export type LockedAuction = {
  status: 'SCHEDULED' | 'OPEN' | 'CLOSED';
  closeAt: Date;
  dbNow: Date;
  floorPriceCents: Cents;
  athleteEmail: NormalizedEmail;
  athleteBanned: boolean;
};

export interface PlaceBidSession {
  upsertBidder(email: NormalizedEmail): Promise<BidderId>;
  findLeading(): Promise<LeadingBid | null>;     // LeadingBid = { id: BidId; bidderId: BidderId; amountCents: Cents }
  markOutbid(bidId: BidId): Promise<void>;
  insertLeading(bidderId: BidderId, amountCents: Cents): Promise<PlacedBid>;
}
```

Branding happens here, at the ORM boundary: ids cast to `BidId`/`BidderId`/`AuctionId`, amounts through `cents()`, the athlete email through `normalizeEmail()` (the unique athlete email is compared with a normalized bidder email; the validating constructor is used rather than a blind cast).

Session semantics:
- `upsertBidder`: `tx.bidder.upsert({ where: { email }, create: { email }, update: {} })` (same shape as `BidderDb.upsertByEmail`, which Prisma compiles to native `INSERT ... ON CONFLICT`). Runs inside the transaction, so a rejected bid rolls the bidder row back and leaves no orphan.
- `findLeading`: `tx.bid.findFirst({ where: { auctionId, status: 'LEADING' } })`.
- `markOutbid`: `tx.bid.update({ where: { id }, data: { status: 'OUTBID' } })`.
- `insertLeading`: `tx.bid.create({ data: { auctionId, bidderId, amountCents, status: 'LEADING' } })`, then `tx.auction.update({ where: { id: auctionId }, data: { currentLeadingBidId: bid.id } })`, returns the bid.

### 4.4 Usecase rules (order matters)

`execute(input)`:
0. `amountCents > MAX_BID_CENTS` -> `InvalidValueError('bid_above_maximum')`, before opening a transaction.
1. `db.withLockedAuction(...)` returns `null` -> `NotFoundError('auction_not_found')`.
Inside the callback:
2. `status !== 'OPEN'` or `closeAt <= dbNow` or `athleteBanned` -> `ConflictError('auction_not_open')`. A banned seller is deliberately indistinguishable from a closed auction (epic decision); the log line says which.
3. `input.email === auction.athleteEmail` -> `ForbiddenError('self_bid_not_allowed')`. Checked before the bidder upsert and before any leader read, and the email is never logged.
4. `bidderId = session.upsertBidder(email)`; `leading = session.findLeading()`.
5. `leading` exists and `leading.bidderId === bidderId` -> `ConflictError('already_leading')`. Placed before the amount check so the current leader always gets this code even when their amount is also too low.
6. `minimum = minimumNextBidCents(leading?.amountCents ?? null, floorPriceCents)`; `amountCents < minimum` -> `InvalidValueError('bid_below_minimum')`. Equal-to-leader is below the minimum (leader + at least $5) so it falls out of this rule (J3). An equal-to-floor first bid is valid.
7. If `leading`: `session.markOutbid(leading.id)` first, then `session.insertLeading(...)`. Demote-then-insert order is forced by `bid_one_leading_per_auction`: inserting first would violate the partial unique index.
8. Return `{ bid, previousLeader }`, where `previousLeader` is `{ bidId, bidderId, amountCents }` of the demoted bid, or `null`.

Errors are the repo's `DomainError` subclasses (mapped by the global `DomainErrorFilter`: Invalid 400, Forbidden 403, NotFound 404, Conflict 409, which is what other usecases in this repo already throw), with a snake_case code and a `warn` log (with auction and bidder ids, no email) at each throw site. A thrown error inside the callback aborts the transaction.

| Code | Class | HTTP | When |
|---|---|---|---|
| `bid_above_maximum` | InvalidValueError | 400 | amount > $1,000,000 |
| `auction_not_found` | NotFoundError | 404 | no such auction |
| `auction_not_open` | ConflictError | 409 | not OPEN, closeAt passed, or seller banned |
| `self_bid_not_allowed` | ForbiddenError | 403 | bidder email equals the auction athlete's email |
| `already_leading` | ConflictError | 409 | bidder already holds the LEADING bid |
| `bid_below_minimum` | InvalidValueError | 400 | below floor (first bid) or below leader + increment (includes equal) |

### 4.5 Serialization with the close job (HYR-8)

`CloseAuctionsUsecaseDb.closeAuction` begins with `updateMany ... SET status = 'CLOSED' WHERE status IN (SCHEDULED, OPEN) AND closeAt <= now`, which takes the same row lock, then reads the LEADING bid. Because place-bid holds `FOR UPDATE` on that row for its whole transaction:
- Bid first: the close job's `updateMany` waits, then (READ COMMITTED re-checks the predicate against the updated row, which still matches) flips the status and its subsequent `findFirst` sees the committed new LEADING bid. The new bid wins; the old one stays OUTBID and becomes LOST.
- Close first: place-bid's lock query waits, then reads `status = CLOSED` and rejects with `auction_not_open`.
No change to the close job is needed. The existing comment in `closeAuction` already documents this contract.

Lock order is always auction row first, then bids/bidder rows, in both flows, so there is no deadlock cycle. A pending close job holds the lock for a few milliseconds.

Clock: the `closeAt` check uses the database `now()`, not the app clock, so every instance shares one time source (the close job's own `closeAt <= now` predicate still uses its app `now`; that is HYR-8 behaviour and unchanged). `now()` is the transaction start, so it predates any wait on the row lock; this is accepted knowingly: the gap is only the lock-wait duration (milliseconds, bounded by the 10 s transaction timeout) and the `closeAt` boundary is already fuzzy.

## 5. Interaction with HYR-11 (seam)

`previousLeader` is returned after the transaction commits; no external call happens while the row lock is held. HYR-11 will decide where the new leader's authorization happens relative to the lock (the likely shape is authorize before calling `placeBid`, void the previous leader's hold after it returns, with a compensating void when `placeBid` throws). That is HYR-11's design; this slice only guarantees the data it needs is returned. Bids stay non-binding until HYR-11.

## 6. Error and edge behavior

- Leader at or near `MAX_BID_CENTS`: `minimumNextBidCents` can exceed the cap, so no further bid can pass both the cap and the minimum. Intended: the cap is a hard ceiling.
- A rejected bid leaves no trace (transaction rolled back, including a newly upserted bidder).
- Transaction timeout 10 s covers lock waits behind a slow contender; Prisma's `maxWait` default (2 s) applies to acquiring a pooled connection. A timeout surfaces as a 500 and is retryable by the client.
- No escrow rows, no events, no notifications written here.

## 7. Testing

Unit (Vitest, nested `describe` per condition, no DB):
- `place-bid.usecase.spec.ts`: fake `PlaceBidUsecaseDb` that runs `work` with a fake session. Cases: amount above max (no transaction opened); auction missing; status SCHEDULED / CLOSED; `closeAt` equal to `dbNow` and before it; seller banned (code is `auction_not_open`); self-bid (no bidder upsert called); already leading even when the amount is too low; first bid below floor, equal to floor (accepted), above floor; bid equal to leader (rejected); bid at exactly the minimum increment under $100 (leader 5_000 -> 5_500 accepted, 5_499 rejected) and above $100 (leader 10_100 -> 10_605 accepted, 10_604 rejected); success with a leader (demote called before insert, `previousLeader` populated); success without a leader (`previousLeader` null); no write after a rejection.
- `place-bid.usecase.db.spec.ts` (`mockDeep<PrismaService>`, same style as the close db spec): lock query (which also selects `now()`) is the first call, then the auction read; `dbNow` is passed through; null on zero rows; the snapshot mapping; session methods issue the expected Prisma calls; `insertLeading` updates `currentLeadingBidId`; transaction timeout option is passed.
- `bid.service.spec.ts`: `placeBid` delegates to the usecase with the input only.

Integration (real Postgres, concurrency; `npm run test:integration`, not part of `npm test`):
- Helper `src/testing/throwaway-database.ts`: connects with an admin URL, `CREATE DATABASE hyrox_it_<random>`, runs `prisma migrate deploy` against it via `execFileSync` with `DATABASE_URL` set, returns a connected `PrismaService`, and drops the database (`DROP DATABASE ... WITH (FORCE)`) in teardown. Applying migrations for real also exercises the hand-written partial unique index, which a mock cannot.
- Admin URL comes from `TEST_ADMIN_DATABASE_URL`, default `postgresql://hyrox:hyrox@localhost:5435/postgres`. The suite skips itself (`describe.skipIf`) when the server is unreachable instead of failing, so `npm run test:integration` is safe on a laptop with no Docker.
- Port gotcha (HYR-3 memory): `docker-compose.yml` publishes Postgres on 5435 and several Conductor workspaces share that port; whichever compose project started first owns it. Reuse the running container (`docker ps`), do not start a second one, and never point the suite at the `hyrox_sponsor` dev database: it only creates and drops its own uniquely named database.
- Scenarios: (1) N concurrent identical valid bids from different emails: exactly one succeeds, the rest `bid_below_minimum`, one LEADING row, `currentLeadingBidId` equals it. (2) Concurrent bids with distinct ascending amounts: exactly one LEADING row equal to the maximum accepted amount, every other accepted bid OUTBID, accepted amounts strictly increase in insertion order by at least the increment, pointer matches. (3) Same bidder fired twice concurrently: one success, one `already_leading`. (4) Deterministic lock proof: hold `FOR UPDATE` in an open transaction, start a bid, assert it has not settled after 300 ms, commit a `CLOSED` flip, assert the bid rejects with `auction_not_open`. (5) Bid versus `CloseAuctionsUsecaseDb.closeAuction` raced 25 times with `closeAt` a few tens of milliseconds ahead of the real clock (varied per iteration) and the close job given `now = closeAt`: if the bid succeeded the bid is `WON` and outcome `AWAITING_PROOF`; if it was rejected the outcome is `NO_SALE` with no bids; never a bid left LEADING on a CLOSED auction.

## 8. Size and PR

Estimated 700 lines including tests: usecase ~110, usecase db ~110, module/service/wiring ~35, unit specs ~320, integration helper and config ~70, integration spec ~150 (several lines are test fixtures). Under the 800 cap, one actor (system/bidder), one layer (backend), no schema. Integration tests (plan Tasks 4-5) stay in this PR by user decision; CI wiring is HYR-42. Fits a single PR; no ticket split proposed.

## 9. Judgment calls to confirm

- J39-1 Error classes and statuses (table in 4.4): `auction_not_open` 409 for banned too; `bid_below_minimum` stays 400 (user decision). `bid_above_maximum` is its own code instead of reusing `bid_below_minimum`.
- J39-2 Input is the normalized email, not a bidder id: the usecase upserts the bidder inside the lock transaction, so a rejected bid creates no bidder row and the self-bid email comparison needs no extra lookup. `BidderService.getOrCreateByEmail` is therefore not called; the upsert shape is duplicated in the session (deliberate, per the narrow-usecase-db rule).
- J39-3 `already_leading` is checked before the amount rules.
- J39-4 (user decision) The `closeAt` check uses the database `now()` selected in the lock statement, returned as `dbNow` in the locked snapshot (transaction-start semantics accepted; lock-wait gap is ms); no `now` is passed in by `BidService`.
- J39-5 Integration tests live outside `npm test` and skip when no Postgres is reachable, because the repo has no existing real-DB test suite and CI (if any) is not known to provide Postgres. Integration tests stay in this PR (user decision); wiring `test:integration` into CI is tracked in HYR-42.
- J39-6 Banned-seller check reads `athlete.isBanned` live under the lock; the auction is not force-closed when an athlete is banned (out of scope).
