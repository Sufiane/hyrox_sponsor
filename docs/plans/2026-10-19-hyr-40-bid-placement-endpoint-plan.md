# HYR-40 Bid Placement HTTP Endpoint Implementation Plan (HYR-9 slice C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose `BidService.placeBid` as `POST /auctions/:auctionId/bids` with DTO validation, a 201 response (no bidder identity), the existing domain-error mapping, a 10/min per-IP throttle, an README docs and a manual concurrency QA checklist.

**Architecture:** `BidController` -> `BidService.placeBid` (unchanged) -> `PlaceBidUsecase`. Controller does branding (`normalizeEmail`, `cents`, `auctionId`) and calls the pure mapper `toPlaceBidResponse`. Errors go through the global `DomainErrorFilter`. No ORM import anywhere in this slice.

**Tech Stack:** NestJS 12, `@nestjs/throttler`, class-validator, Vitest 5 (globals), vitest-mock-extended.

**Spec:** `docs/specs/2026-10-19-hyr-40-bid-placement-endpoint-design.md`. Builds on `docs/specs/2026-10-19-hyr-39-place-bid-usecase-design.md`.

**Size:** about 380 lines including tests and docs. One PR under the 800 cap, no ticket split. Backend-only; nothing for a frontend builder. Server code is at the repo root `src/` (not `server/`). Branch must be `hyr-40` (rename from `raleigh/hyr-40-handle` BEFORE pushing or opening the PR).

**Decisions (coordinator):** no launch gate (API not live yet; README notes HYR-11 must ship before public exposure); keep `self_bid_not_allowed` (documented, no rename).

Task order: 1 -> 2 -> 3 sequential; 4 and 5 after 3 (independent of each other); 6 last.

## Global Constraints

- Explicit return types on every function/method; no single-letter variables (except `i/j/k` in indexed `for`); no inline `if`; blank line before `if/for/while/return/throw` unless first in block; no `!!`; no commented-out code; no barrel files; numeric separators on literals of 5+ digits (`60_000`, `100_000_000`).
- Constructor parameter properties `readonly`.
- Comments only for a non-obvious why, max two lines.
- Errors: `DomainError` subclasses from `src/common/domain-error.ts`, snake_case code, `Logger.warn` with ids at the throw site, never log the email.
- Vitest: nested `describe` per condition (`when ...`), `it` titles state the outcome only, shared setup in that `describe`'s `beforeEach`.
- Dependencies: none new. If one is needed, pin exactly (no caret).
- Conventional Commits (lowercase imperative), end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage for `/crit`; do NOT commit until the user approves.
- Linear HYR-40: In Progress when starting; In Review only once staged.
- Full check: `npm run verify:fast` (lint, lint:arch, typecheck, test).

---

## Task 1: Usecase result carries `closeAt` (~15 lines)

**Files:** modify `src/bids/usecases/place-bid/place-bid.usecase.ts`, `src/bids/usecases/place-bid/place-bid.usecase.spec.ts`.

- [ ] **Step 1: failing test.** In the existing success describes of `place-bid.usecase.spec.ts` (with and without a leader), add `it('returns the auction closeAt', ...)` asserting `result.closeAt` equals the fake snapshot's `closeAt`.
- [ ] **Step 2: run** `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.spec.ts`; expect FAIL (`closeAt` undefined).
- [ ] **Step 3: implement.**

```ts
export type PlaceBidResult = { bid: PlacedBid; closeAt: Date; previousLeader: PreviousLeader | null };
// in place(): return { bid, closeAt: auction.closeAt, previousLeader: ... };
```

- [ ] **Step 4: run** the usecase spec, `bid.service.spec.ts`; expect PASS. `npx tsc --noEmit` (the int spec compiles against the type; `npm run test:integration` is optional and skips without Postgres).
- [ ] **Step 5:** stage.

## Task 2: DTOs and response mapper (~90 lines with tests)

**Files:** create `src/bids/dto/place-bid.dto.ts`, `src/bids/dto/auction-bid-params.dto.ts`, `src/bids/place-bid-response.ts`, `src/bids/place-bid-response.spec.ts`.

- [ ] **Step 1: failing spec** `place-bid-response.spec.ts`:
  - `describe('when the bid is under the $100 threshold')`: bid 5_000 -> `minimumNextBidCents` 5_500.
  - `describe('when the bid is at or above the $100 threshold')`: bid 10_000 -> 10_500; bid 10_100 -> 10_605.
  - `describe('when mapping a result')`: `Object.keys(response).sort()` equals exactly `['amountCents','auctionId','bidId','closeAt','minimumNextBidCents','placedAt','status']`; `status` is `'LEADING'`; no `bidderId`/`email`/`previousLeader` keys even when `previousLeader` is set on the input.
- [ ] **Step 2: run**, expect FAIL (module missing).
- [ ] **Step 3: implement.**

```ts
// src/bids/place-bid-response.ts
import type { AuctionId, BidId } from '../common/ids';
import { addCents, type Cents } from '../common/money';
import { minimumIncrementCents } from './bid-increment';
import type { PlaceBidResult } from './usecases/place-bid/place-bid.usecase';

export type PlaceBidResponse = {
  bidId: BidId;
  auctionId: AuctionId;
  amountCents: Cents;
  status: 'LEADING';
  placedAt: Date;
  closeAt: Date;
  minimumNextBidCents: Cents;
};

export function toPlaceBidResponse(result: PlaceBidResult): PlaceBidResponse {
  const { bid } = result;

  return {
    bidId: bid.id,
    auctionId: bid.auctionId,
    amountCents: bid.amountCents,
    status: 'LEADING',
    placedAt: bid.placedAt,
    closeAt: result.closeAt,
    minimumNextBidCents: addCents(bid.amountCents, minimumIncrementCents(bid.amountCents)),
  };
}
```

```ts
// src/bids/dto/place-bid.dto.ts
import { IsEmail, IsInt, MaxLength, Min } from 'class-validator';

const EMAIL_MAX_LENGTH = 254;

export class PlaceBidDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsInt()
  @Min(1)
  amountCents!: number;
}
```

```ts
// src/bids/dto/auction-bid-params.dto.ts  (same shape as RaceEntryParamsDto)
@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? auctionId(value) : value))
@IsString()
auctionId!: AuctionId;
```

- [ ] **Step 4: run** the mapper spec; expect PASS. Stage.

## Task 3: Controller, module wiring, error mapping tests (~230 lines with tests)

**Files:** create `src/bids/bid.controller.ts`, `src/bids/bid.controller.spec.ts`; modify `src/bids/bids.module.ts`.

- [ ] **Step 1: failing spec** `bid.controller.spec.ts`. Helper `startApp(placeBid)` builds `Test.createTestingModule({ controllers: [BidController], providers: [{ provide: BidService, useValue: { placeBid } }] })`, then `createNestApplication()`, `app.useGlobalFilters(new DomainErrorFilter())`, `app.useGlobalPipes(createValidationPipe())`, `app.listen(0)`; a `postBid(body, auctionId = 'auc-1')` helper using `fetch` returns `{ status, json }`. Throttler is not imported here (isolated; Task 4 covers it). Cases:
  - `describe('when the usecase succeeds')`: 201; body equals the mapped response (ISO date strings); `placeBid` called once with `{ auctionId: 'auc-1', email: 'jamie@x.com', amountCents: 5_500 }` when the request email is `'Jamie@X.com'` (lowercased by `normalizeEmail`; `@IsEmail` rejects surrounding spaces); assert response has no `bidderId`/`email`/`previousLeader`.
  - `describe('when the usecase throws a domain error')` with `it.each` over `[ [InvalidValueError,'bid_below_minimum',400], [InvalidValueError,'bid_above_maximum',400], [ForbiddenError,'self_bid_not_allowed',403], [NotFoundError,'auction_not_found',404], [ConflictError,'auction_not_open',409], [ConflictError,'already_leading',409] ]`: status and `message` equal the code.
  - `describe('when the body is invalid')` with `it.each`: missing email, `not-an-email`, `amountCents` 0, 12.5, `'5000'`, missing amount, extra field `bidderId`: 400 `validation_failed`, `placeBid` not called.
  - `describe('when the auction id is blank')`: path `/auctions/%20/bids` -> 400 `auction_id_invalid`.
- [ ] **Step 2: run** `npx vitest run src/bids/bid.controller.spec.ts`; expect FAIL.
- [ ] **Step 3: implement.**

```ts
// src/bids/bid.controller.ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { normalizeEmail } from '../common/email';
import { cents } from '../common/money';
import { BidService } from './bid.service';
import { AuctionBidParamsDto } from './dto/auction-bid-params.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { toPlaceBidResponse, type PlaceBidResponse } from './place-bid-response';

const PLACE_BID_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auctions/:auctionId/bids')
export class BidController {
  constructor(private readonly service: BidService) {}

  @Post()
  @Throttle(PLACE_BID_LIMIT)
  async placeBid(@Param() params: AuctionBidParamsDto, @Body() body: PlaceBidDto): Promise<PlaceBidResponse> {
    const result = await this.service.placeBid({
      auctionId: params.auctionId,
      email: normalizeEmail(body.email),
      amountCents: cents(body.amountCents),
    });

    return toPlaceBidResponse(result);
  }
}
```

  Add `controllers: [BidController]` to `BidsModule`.
- [ ] **Step 4: run** the controller spec; expect PASS. `npx tsc --noEmit`.
- [ ] **Step 5: wiring check.** `npm run lint:arch` (controller imports only `BidService`, no db/usecase/ORM). Stage.

## Task 4: Throttle spec (~70 lines)

**Files:** create `src/bids/bid-throttle.spec.ts`.

- [ ] **Step 1: write spec** modelled on `src/auth/auth-throttle-client-ip.spec.ts` but with the real `BidController`: module imports `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])`, providers `{ provide: APP_GUARD, useClass: ThrottlerGuard }` and a fake `BidService.placeBid` resolving a fixed result; `applyTrustProxy(app, hops)`; send valid bodies with an `X-Forwarded-For` header.
  - `describe('when one client sends eleven bids in a minute')` (hops 1): first ten are 201, the eleventh is 429.
  - `describe('when two clients behind one trusted hop each send ten bids')`: all twenty are 201 (separate buckets).
- [ ] **Step 2: run** `npx vitest run src/bids/bid-throttle.spec.ts`; expect PASS (the decorator landed in Task 3). To prove the test bites, temporarily change the limit to 11 locally and confirm failure, then revert (do not commit the change).
- [ ] **Step 3:** stage.

## Task 5: README and manual QA checklist (~70 lines)

**Files:** modify `README.md` (new `## Bidding (HYR-40)` section after "Auction scheduling (HYR-8)"); create `docs/qa/hyr-40-bid-concurrency-checklist.md`.

- [ ] **Step 1: README section** covering: route and body (`email`, `amountCents` integer cents), the 201 response fields, the error table from spec 4.5 (note the self-bid code is `self_bid_not_allowed`, not the ticket's `cannot_bid_on_own_auction`), throttle (10/min per client IP, in-memory per instance, counts rejected requests; correct only when `TRUST_PROXY_HOPS` matches the topology, else all bidders share the proxy bucket), a note that there is no code gate: bids are non-binding until HYR-11 (Stripe hold), so HYR-11 must ship before the API is exposed publicly, and a link to the spec and the QA checklist. Also note the accepted `already_leading` probe leak.
- [ ] **Step 2: QA checklist** `docs/qa/hyr-40-bid-concurrency-checklist.md`, with prerequisites (Postgres up on the shared port, `TRUST_PROXY_HOPS=0`, a seeded OPEN auction id, scheduler disabled for the race step) and checkboxes for:
  1. Happy path: single `curl -X POST .../auctions/$ID/bids -d '{"email":"a@x.com","amountCents":<floor>}'` -> 201, no bidder fields, `minimumNextBidCents` correct.
  2. Parallel identical bids: 10 background `curl`s (`&` + `wait`) with distinct emails and the same amount -> exactly one 201, the rest 400 `bid_below_minimum`; DB has one LEADING row and `auctions.current_leading_bid_id` matches it (give the psql query).
  3. Parallel ascending bids: distinct emails, amounts floor+0..floor+9 x increment -> exactly one LEADING row equal to the max accepted amount; all others OUTBID.
  4. Same email twice in parallel -> one 201, one 409 `already_leading`.
  5. Race with close job: set `close_at` ~5 s ahead, start a bid loop (one bid per 200 ms, rising amounts) across the boundary with the scheduler enabled; afterwards: no bid LEADING on a CLOSED auction, the last accepted bid is `WON` or outcome `NO_SALE` with no bids, bids after close return 409 `auction_not_open`. Repeat 3 times.
  6. Error spot checks: unknown auction id 404, self-bid (athlete email) 403, amount above $1,000,000 400, amount 0 400, extra `bidderId` field 400.
  7. Throttle: 11 requests in one minute from one client -> the 11th is 429; with `TRUST_PROXY_HOPS=1` and different `X-Forwarded-For` values the buckets are separate.
- [ ] **Step 3:** stage.

## Task 6: Verification and handoff

- [ ] Run `npm run verify:fast`; all green. Run `npm run test:integration` if Postgres is reachable (optional; the Task 1 change touches the type it uses).
- [ ] Confirm `git status` shows only the files listed above, nothing unstaged. Do not commit. Tell the user the work is staged and they can run `/crit`.
- [ ] Move HYR-40 to In Review once staged. Branch rename to `hyr-40` before any push.
- [ ] Open follow-up tickets (proposed, not part of this PR): (a) `bid_below_minimum` body carries current minimum (OQ-3); (b) per-email / per-auction throttle and bot protection (OQ-4); (c) web bid form + BFF route.
