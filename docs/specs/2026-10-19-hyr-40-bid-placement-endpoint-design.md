# HYR-40: Bid Placement HTTP Endpoint with Throttle (HYR-9 slice C) - Design Spec

Status: APPROVED. Coordinator decisions: no launch gate (API not live yet); keep `self_bid_not_allowed`.
Ticket: HYR-40, slice C of epic HYR-9. Backend only.
Plan: `docs/plans/2026-10-19-hyr-40-bid-placement-endpoint-plan.md`.
Date: 2026-10-19
Depends on: HYR-39 (merged, 500b7c5: `PlaceBidUsecase`, `BidService.placeBid`), HYR-38 (increment rules), HYR-31 (`TRUST_PROXY_HOPS` client-IP keying). Blocks: web bid UI (later slice). HYR-11 (Stripe hold) must ship before the API is exposed publicly (bids are non-binding until then); there is no code gate, see section 3.

Repo note: the server lives at the repo root `src/` (the ticket says `server/`; there is no such directory).

## 1. Context

`BidService.placeBid(input)` exists and is tested (unit + real-Postgres concurrency specs). Nothing exposes it over HTTP. This slice adds the controller, DTOs, response mapping, a per-IP throttle, docs and a manual concurrency QA checklist. No schema change, no new dependency, no change to locking.

Identity model (HYR-4): bidding is guest checkout. The caller sends an email; the usecase upserts the `Bidder` row inside the locked transaction. There is no auth on this route, and an email is an unverified claim. The athlete JWT guard is not used (an athlete may legitimately bid on other athletes' zones; self-bid is rejected by the usecase by email comparison).

## 2. Scope

In:
- `POST /auctions/:auctionId/bids` in `src/bids/bid.controller.ts`, registered in `BidsModule`.
- `PlaceBidDto` (body), `AuctionBidParamsDto` (path), pure response mapper `toPlaceBidResponse`.
- Usecase result gains `closeAt` (one-line additive change to HYR-39 code; see 4.3).
- `@Throttle` 10 requests / 60 s per client IP on this route.
- README section and manual QA checklist `docs/qa/hyr-40-bid-concurrency-checklist.md`.

Out (own tickets, not footnotes):
- Web bid UI / BFF proxy route (later slice, after this one).
- Stripe hold (HYR-11). Bids stay non-binding until then.
- Per-email / per-auction rate limits, bot protection (Turnstile), email verification.
- Carrying the current minimum in the 400 `bid_below_minimum` body (follow-up ticket, see OQ-3).
- `GET` of auction bid state (no read endpoint in this slice).

## 3. Approaches considered

Where the HTTP mapping of domain errors lives:
- A. Reuse the global `DomainErrorFilter` (chosen). It already maps `InvalidValueError` 400, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409 and every usecase code is already one of those classes. Zero new mapping code; the controller spec proves each code lands on the right status.
- B. Per-controller exception filter or try/catch. Duplicates the filter. Rejected.

Throttle:
- A. `@Throttle` on the handler with the existing in-memory `ThrottlerModule` storage and default IP tracker (chosen). Same pattern as auth and race-result routes; client IP correctness comes from `applyTrustProxy` (HYR-31).
- B. Redis-backed or per-email tracker. Over-engineered for MVP; in-memory storage is per instance, so the effective limit is 10 x instance count. Accepted and documented. Rejected for now.

Launch gate (decided: none):
- The API is not live yet, so no `BIDDING_ENABLED` flag or guard is added. The only control is process: HYR-11 must ship before public exposure (README note). Revisit if a deploy to a reachable environment happens before HYR-11.

## 4. Design

### 4.1 Route and DTOs

`POST /auctions/:auctionId/bids`, handler `@HttpCode(201)` (the Nest POST default).

```ts
class AuctionBidParamsDto {
  @Transform(({ value }) => (typeof value === 'string' ? auctionId(value) : value))
  @IsString()
  auctionId!: AuctionId;
}

class PlaceBidDto {
  @IsEmail() @MaxLength(254)
  email!: string;

  @IsInt() @Min(1)
  amountCents!: number;
}
```

The global `createValidationPipe` (whitelist + forbidNonWhitelisted) means an extra field such as `bidderId` is a 400 `validation_failed`; a client can never inject identity. The controller builds the usecase input with `normalizeEmail(body.email)` and `cents(body.amountCents)`; the usecase caps at `MAX_BID_CENTS` (`bid_above_maximum`, 400).

Amounts are integer cents on the wire, matching the usecase (`amountCents` in the response too). No dollar/decimal form.

### 4.2 Response (201)

```ts
type PlaceBidResponse = {
  bidId: BidId;
  auctionId: AuctionId;
  amountCents: Cents;
  status: 'LEADING';
  placedAt: Date;               // ISO string on the wire
  closeAt: Date;
  minimumNextBidCents: Cents;
};
```

No `bidderId`, no email, no `previousLeader` (HYR-11 seam stays server-side). `status` is the constant `'LEADING'`: a freshly placed bid is always the leader, and the usecase result does not carry a status. `minimumNextBidCents` = `amount + minimumIncrementCents(amount)` (HYR-38 rule), so the client can pre-fill the next bid.

### 4.3 Usecase touch

`PlaceBidResult` gains `closeAt: Date` taken from the locked auction snapshot already in scope in `place()`. Additive: existing consumers and HYR-39 tests keep passing; the unit specs add one expectation. This is part of this ticket because the response contract requires it.

### 4.4 Layering

controller (branding, mapping) -> `BidService.placeBid` (unchanged thin delegate) -> `PlaceBidUsecase` -> `PlaceBidUsecaseDb`. The controller imports no ORM and never touches the usecase directly. `lint:arch` already enforces the direction; the controller only imports `BidService`.

### 4.5 Error mapping

All via the global `DomainErrorFilter`. Body shape is the existing `{ statusCode, message: <code>, error }`.

| Source | Code | Status |
|---|---|---|
| DTO / pipe | `validation_failed` | 400 |
| `auctionId()` | `auction_id_invalid` | 400 |
| usecase | `bid_above_maximum`, `bid_below_minimum` | 400 |
| usecase | `self_bid_not_allowed` (the ticket text says `cannot_bid_on_own_auction`; decided to keep the HYR-39 code) | 403 |
| usecase | `auction_not_found` | 404 |
| usecase | `auction_not_open` (not OPEN, closed, banned seller), `already_leading` | 409 |
| throttler | (default Nest body) | 429 |

### 4.6 Throttle

`const PLACE_BID_LIMIT = { default: { limit: 10, ttl: 60_000 } }`, same shape as `SENSITIVE_ROUTE_LIMIT` in `AuthController`. Counted per client IP, every request including rejected ones. Behind the BFF the IP is correct only when `TRUST_PROXY_HOPS` matches the topology (HYR-31/32); with it at 0 all bidders share the proxy's bucket. The README states this. The global `ThrottlerGuard` runs before the validation pipe, so 429 is returned before any DB work.

Anti-sniping is out of scope (epic decision: none), so 10/min is enough for a legitimate bidder near close.

## 5. Security notes

- Unverified email: anyone can bid as anyone (HYR-4 Q2). Harm is bounded because the card hold (HYR-11) belongs to the real payer; until HYR-11 bids are non-binding, which is why HYR-11 must ship before public exposure.
- Accepted leak: `409 already_leading` tells a caller whether the email they typed currently leads that auction. Low value, consistent with HYR-4 (no bidder data readable by email, but this one boolean is observable). The throttle limits probing. Flagged, not fixed.
- Response carries no bidder identity or email; logs never contain the email (usecase rule).
- No idempotency key: a retried request after a lost response gets `already_leading` 409, which is a safe natural outcome.

## 6. Testing (Vitest, nested `describe` per condition)

- `place-bid-response.spec.ts`: field mapping; `minimumNextBidCents` below and at/above the $100 threshold; exact key set (no identity fields).
- `bid.controller.spec.ts`: Nest app with a fake `BidService`, `DomainErrorFilter` and `createValidationPipe`, `fetch` against `app.listen(0)` (same style as `auth-throttle-client-ip.spec.ts`). 201 body; service receives the normalized email, branded cents and auction id; each domain code -> status from the table; validation failures (missing/invalid email, amount 0, non-integer, string, extra `bidderId` field, bad auction id).
- `bid-throttle.spec.ts`: real controller, `ThrottlerModule` global 60/min, fake service: 11th request in a minute -> 429; with `applyTrustProxy(app, 1)` two `X-Forwarded-For` clients get separate buckets.
- `place-bid.usecase.spec.ts`: result includes `closeAt`.
- Manual QA checklist (not automated; HYR-39 already has the real-Postgres race suite): parallel curl bids, bid versus close job, throttle. Lives in `docs/qa/`.

## 7. Size

About 380 lines with tests and docs (ticket estimate 280 covered code only). Code ~130 (controller 45, DTOs 25, mapper 25, usecase/module wiring 10, misc), tests ~170, README ~20, checklist ~50. Under the 800 cap, one actor (public bidder), one layer (backend), no schema. Single PR, no ticket split.

## 8. Open questions and judgment calls

- OQ-1 (decided) No launch gate. README notes HYR-11 must ship before public exposure.
- OQ-2 (decided) Keep `self_bid_not_allowed` (403); documented in README and section 4.5.
- OQ-3 `bid_below_minimum` stays 400 (HYR-39 user decision J39-1) although the ticket groups "state rejections" under 409. When a rival outbids first, the client receives 400 without the new minimum. Follow-up ticket proposed: return `minimumNextBidCents` in that error body (or a read endpoint) before the web bid form ships.
- OQ-4 Per-IP only, in-memory storage (per instance). Per-email/auction limiting and bot protection are follow-up tickets, not part of this slice.
- J40-1 Controller lives in `BidsModule` under `auctions/:auctionId/bids` (no `AuctionsModule` controller exists).
- J40-2 `status` is the constant `'LEADING'` rather than read from the DB.
- J40-3 Public unauthenticated route, no JWT guard.
