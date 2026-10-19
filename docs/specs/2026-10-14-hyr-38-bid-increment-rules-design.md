# HYR-38: Bid Increment Rules and Money/Id Primitives (HYR-9 slice A) - Design Spec

Status: PROPOSED (inherits the umbrella's judgment calls, J-numbers below).
Ticket: HYR-38, slice A of epic HYR-9 "Bid placement + increment validation ($5 flat under $100, 5% above)".
Umbrella: `docs/specs/2026-10-14-bid-placement-design.md` (this spec derives from it and must not contradict it). Umbrella plan: `docs/plans/2026-10-14-bid-placement-plan.md`.
Plan: `docs/plans/2026-10-14-hyr-38-bid-increment-rules-plan.md`.
Date: 2026-10-14
Depends on: nothing. Depended on by: HYR-39 (consumes everything here), HYR-40 (consumes `auctionId`).

## 1. Context

HYR-9 adds guest bid placement. The money rule and the id/money building blocks it needs do not exist yet: `src/common/money.ts` has `cents`, `addCents`, `percentOfCents` (floors), and `src/common/ids.ts` has types for `AuctionId`, `BidId`, `BidderId` but constructors only for athlete, race, race entry, race result and staff ids.

This slice delivers only pure, dependency-free code so the next slices can rely on stable signatures. No Prisma, no Nest, no HTTP, no schema change.

## 2. Scope

In:
- `ceilPercentOfCents(amount, percent)` in `src/common/money.ts`.
- `auctionId(value)` and `bidderId(value)` constructors in `src/common/ids.ts`.
- `src/bids/bid-increment.ts`: constants and the two pure functions below.
- Specs for all of the above.

Out (belongs to later slices):
- Anything touching the DB, the lock, bidder lookup, `BidService`, DTOs, controller, README, QA (HYR-39, HYR-40).
- A `bidId` constructor: nothing in the epic needs one (bid ids only come from the DB, branded in `*.db.ts`).
- Changing `percentOfCents` (it floors and other code may rely on it).

## 3. Decisions that apply (umbrella numbering)

- J1 Rounding: 5% is rounded UP to a whole cent. At exactly $100 both rules give 500, so there is no gap or overlap; `leader >= 10_000` uses the percent rule.
- J2 Precision: any integer cents, no whole-dollar rule. Max bid $1,000,000 (`MAX_BID_CENTS = 100_000_000`) as fat-finger and Int32 guard (`Bid.amountCents` is a 32-bit Int, about $21.4M).
- J3 Equal bid: a bid equal to the leader is below `leader + increment` and therefore invalid; an equal-to-floor first bid is valid. This slice encodes it through `minimumNextBidCents` (a bid is valid when `amount >= minimum`); the comparison itself lives in HYR-39.

## 4. Interfaces

### `src/common/money.ts` (added)

```ts
export function ceilPercentOfCents(amount: Cents, percent: number): Cents
```
- Throws `InvalidValueError('percent_invalid')` when `percent` is negative or not finite (same validation as `percentOfCents`).
- Result: `cents(Math.ceil((amount * percent) / 100))`. With the 100M-cent cap and percent 5 the product stays far below 2^53.
- `percentOfCents` is unchanged.

### `src/common/ids.ts` (added)

```ts
export function auctionId(value: string): AuctionId   // InvalidValueError('auction_id_invalid')
export function bidderId(value: string): BidderId     // InvalidValueError('bidder_id_invalid')
```
Both go through the existing private `validatedId`: trim, reject empty, reject longer than 64 characters.

### `src/bids/bid-increment.ts` (new)

```ts
export const INCREMENT_FLAT_CENTS: Cents        // cents(500)
export const INCREMENT_THRESHOLD_CENTS: Cents   // cents(10_000)
export const INCREMENT_PERCENT = 5
export const MAX_BID_CENTS: Cents               // cents(100_000_000)

export function minimumIncrementCents(leader: Cents): Cents
export function minimumNextBidCents(leader: Cents | null, floor: Cents): Cents
```
- `minimumIncrementCents`: `leader < 10_000` -> 500; otherwise `ceilPercentOfCents(leader, 5)`.
- `minimumNextBidCents(null, floor)` -> `floor`; otherwise `addCents(leader, minimumIncrementCents(leader))`.
- Examples: leader 10_100 -> increment 505, next 10_605. Leader 10_010 -> 500.5 -> increment 501. Leader 99_999_999 -> increment 5_000_000.
- Pure; no logging; the only thrown codes are `cents_invalid` / `percent_invalid` from the helpers it calls.

## 5. Error codes

This slice adds no HTTP-visible code. New helper-level codes: `auction_id_invalid`, `bidder_id_invalid` (400 once HYR-40 surfaces the first through the params DTO), `percent_invalid` (programmer error, never reachable from input).

## 6. Testing

Vitest, nested `describe` per condition, no mocks (pure code).
- `money.spec.ts`: `ceilPercentOfCents` exact, fractional (rounds up), zero, negative or NaN percent.
- `ids.spec.ts`: `auctionId` and `bidderId` accept and trim, reject blank, `auctionId` rejects 65 characters.
- `bid-increment.spec.ts`: table tests at 0, $10, $99.99 (500), exactly $100.00 (500, boundary), $100.10 (501, ceil), $101 (505), $1,000 (5_000), near the cap; `minimumNextBidCents` with no leader, leader under $100, leader above $100.

## 7. Files

New: `src/bids/bid-increment.ts`, `src/bids/bid-increment.spec.ts`.
Modified: `src/common/money.ts`, `src/common/money.spec.ts`, `src/common/ids.ts`, `src/common/ids.spec.ts`.

## 8. Size and PR

About 170 lines including tests; far under the 800 cap. Backend-only, one layer, no actor-facing surface (library code, tested but not yet used until HYR-39). Merges independently; ships nothing user-visible, which is acceptable per the umbrella split (spec section 10). PR title: `feat(bids): add bid increment rules`.

## 9. Dependents

- HYR-39 imports `MAX_BID_CENTS`, `minimumNextBidCents`, `bidderId`.
- HYR-40 imports `auctionId`.
- Any signature change here after merge requires updating both specs.
