# HYR-11: Per-bid Stripe authorization hold + release-on-outbid - Design Spec

Status: APPROVED 2026-11-27. User chose D1 option (c), D2 as a separate launch-blocking ticket, D5 drop `email`, and the stacked PR split in section 7. Date: 2026-11-27. Linear: HYR-11 (branch `hyr-11`).
Plan: `docs/plans/2026-11-27-hyr-11-bid-authorization-hold.md`.
Depends on: HYR-39/40 (place-bid usecase + endpoint), HYR-58 (gateway customer/setup intent), HYR-59 (`BidderTokenService`, `X-Bidder-Token`, `token_version`), HYR-60 (card columns written by webhook), HYR-1 (adapter, webhook registry, fund flow A). Blocks: HYR-12 (close job captures the winning hold), HYR-13.

## 1. Context (what exists)

- `POST /auctions/:auctionId/bids` (HYR-40): body `{ email, amountCents }`, unauthenticated, 10/min/IP throttle, no launch gate. Controller -> `BidService.placeBid` (thin delegate) -> `PlaceBidUsecase.execute` -> `PlaceBidUsecaseDb.withLockedAuction` (single transaction, `SELECT ... FOR UPDATE` on the auction row first, 10 s timeout). The usecase upserts the bidder by email inside the transaction, demotes the previous leader to `OUTBID`, inserts the new `LEADING` bid, and returns `previousLeader` after commit. No external call happens under the lock (HYR-39 section 5, the seam for this ticket).
- `bidders`: `stripe_customer_id`, `default_payment_method_id`, `card_brand`, `card_last4`, `token_version`. "Saved card" = `default_payment_method_id IS NOT NULL` (HYR-59 Q7). A trigger bumps `token_version` whenever the card id changes (HYR-60 Q5).
- `BidderTokenService.verify(raw)` returns `{ bidderId, tokenVersion }` or throws `401 bidder_token_required`. The caller must compare `tokenVersion` with the row (HYR-59 Q15). `BidderTokenModule` is importable without a cycle.
- `StripeGateway` (port) + `StripeAdapter` (only Stripe SDK importer): accounts, customer, setup intent, payment method, webhook parsing. No PaymentIntent methods. `stripe@23.1.0`, API `2026-10-28.endive`, `maxNetworkRetries: 2` (the SDK adds its own idempotency key on retries). Errors map to `StripeRejectedError` (422), `StripeUnavailableError` / `StripeMisconfiguredError` (502).
- `escrow_transactions` (HYR-2): `bid_id` (NOT NULL), `stripe_payment_intent_id`, `type` (`AUTHORIZED/VOIDED/CAPTURED/REFUNDED/FAILED`), `amount_cents`, `created_at`. Nothing writes it yet. `EscrowTransactionService.hasActiveAuthorization(bidId)` reads the latest row.
- Auction window (HYR-8): opens at race-12d local midnight, closes at race-5d local midnight, so a bid lives at most about 7 days before close (DST can shift this by an hour). Close job (`CloseAuctionsUsecaseDb.closeAuction`) flips `LEADING` -> `WON`, `OUTBID` -> `LOST`, never calls Stripe.
- HYR-1 fund flow A (confirmed): separate charges and transfers, capture at close, funds sit on the platform balance, Transfer to the athlete after proof (HYR-14), refund otherwise.
- Web: no bid form or auction page exists. `web/src/lib/bidder` holds the HYR-61 card-capture component and the bidder token store (`/dev/card` harness only).

## 2. Scope

In:
1. Bid endpoint requires `X-Bidder-Token`; token version must match the bidder row.
2. "Card required to bid" gate.
3. Per-bid manual-capture PaymentIntent authorization ("hold") on the saved card for the bid amount, placed before the bid is committed.
4. Compensating cancel when the hold succeeded but the bid did not commit.
5. Release-on-outbid: cancel the previous leader's hold after the new bid commits.
6. `escrow_transactions` writes (`AUTHORIZED`, `VOIDED`) and the schema tweaks they need.
7. Gateway port + adapter methods `authorizeHold`, `cancelHold`.
8. README, unit, integration and HTTP tests.

Out (own tickets, section 9): capture at close and expired-hold fallback (HYR-12), re-authorization job, retry sweep for failed releases, `payment_intent.*` webhook reconciliation, post-card-save token reissue (D2), web bid UI, SCA / 3DS handling.

## 3. Decisions

### D1 (USER APPROVED (c)): what "hold" means given the ~7 day authorization limit

Facts that shape it:
- Stripe card authorizations expire. The validity window depends on network and how the payment is initiated (about 7 days for most online card payments, shorter for some network / merchant-initiated combinations). Stripe reports the exact deadline per charge as `latest_charge.payment_method_details.card.capture_before`; uncaptured PaymentIntents are canceled by Stripe after it.
- With capture at close (HYR-1 A), the oldest possible hold at close is open-to-close, about 7 days. HYR-1 assumed ~14 days because it counted to proof time; capture-at-close halves that. A leader who bids in the first hours of the window will often hit or pass `capture_before` right at close. Late bids (the usual auction pattern) are well inside it.
- Holds are on a saved card through `off_session` (HYR-58), so a fresh charge at close is always technically possible without the bidder.

| Option | What happens | For | Against |
|---|---|---|---|
| (a) Per-bid hold + cancel on outbid + re-authorize before expiry | Same as (c) plus a scheduled job that, for each `LEADING` bid whose hold's `capture_before` is within N hours, creates a new hold, records it, then cancels the old one. | Every leader has a live hold at close; the only decline window is the re-auth itself (still before close, so the auction could still react). | A second job with its own failure modes (re-auth declines while leading: do we demote the leader? reopen to the previous bidder? who is notified?). Brief double hold on the card. Another ~400 lines plus product rules that do not exist yet. |
| (b) No hold; validate card at bid, charge at close | Bid checks only that a saved card exists. HYR-12 charges `off_session` at close. | Smallest. No orphan or release problems at all. | Drops the ticket's guarantee: insufficient funds, a card that was never good, or a card-testing account are discovered only at close. Every bid becomes non-binding in practice. Contradicts the ticket title and the core data model ("per-bid-lifecycle auth hold"). |
| (c) Per-bid hold + cancel on outbid; HYR-12 captures if the hold is still valid, else charges `off_session` fresh (RECOMMENDED) | Each accepted bid holds its full amount until outbid. The hold's `capture_before` is stored. At close HYR-12 captures when `now < capture_before`, otherwise (or on capture failure) creates a new `off_session` charge on the same saved card. | Funds and card validity are proven at bid time for every bid; fake / empty cards are stopped where it matters. No re-auth job. Fallback reuses a path HYR-12 needs anyway (capture can fail for other reasons). | An early leader whose hold expired can still decline at close (same failure as (b), but only for that subset). HYR-12 must own the decline-at-close outcome (NO_SALE vs offer to runner-up: HYR-12's product call). |

Recommendation: (c). It keeps the guarantee where bidding actually happens, adds no job, and leaves (a) as a cheap upgrade later: the stored `capture_before` is exactly what a re-auth job would query. Follow-up ticket "re-authorize leading holds nearing expiry" is filed but not scheduled until decline-at-close data says it is needed.

### D2 (USER APPROVED: separate ticket, blocks launch, not merge): card owner's own token dies when the card is saved

`create-payment-setup` issues the token with the current `token_version` (0 for a new bidder). The HYR-60 webhook writes the card and bumps the version to 1 (trigger + explicit increment). The owner's token now carries `ver: 0` and fails the version check. Calling the setup endpoint again also fails, because a carded bidder needs a token whose version matches. Result: once HYR-11 enforces tokens on bids, nobody whose card was saved through the normal flow can bid until a reissue path exists.

This is a new feature (token reissue after card save, for example exchanging the old token plus the confirmed setup intent id for a fresh token, or HYR-62's magic link), not an extension of HYR-11. Recommendation: separate ticket, check whether HYR-62 already covers the post-save case, and make it a hard prerequisite for exposing bidding publicly (the HYR-40 "no public exposure" rule moves to it). HYR-11 still enforces the version check exactly as HYR-59 Q15 requires; weakening it here would reopen the squatting hole.

### Other decisions (judgment)

| # | Question | Decision | Why / alternative |
|---|---|---|---|
| D3 | Where does the hold happen relative to the row lock? | Outside and before the transaction: unlocked preflight -> authorize -> locked place (re-validates, writes bid + `AUTHORIZED` row atomically) -> commit -> release previous leader. | No network call under `FOR UPDATE` (HYR-39 rule; a Stripe call can take seconds and would serialise all bidders on that auction and risk the 10 s timeout). The opposite order (commit first, authorize after) needs a "pending" bid state and an un-demote path when auth fails after the previous leader was already demoted and maybe released; rejected. With this order, "bid commits but auth failed" cannot happen. |
| D4 | Unlocked preflight before authorizing | Yes. Read the auction snapshot and current leader without a lock and run the same pure validation (`assertBiddable`) used under the lock: not found, not open, closed by time, banned seller, self-bid, already leading, below minimum. | Most rejected bids are "below minimum" / "already leading"; without the preflight each would place and cancel a real hold on the bidder's card. Under the lock the full check runs again, so the preflight only has to be cheap, not authoritative. |
| D5 (USER APPROVED) | Identity source on the bid | Bidder comes from the token. `email` is removed from `PlaceBidDto` (unknown field -> `400 validation_failed`). The self-bid check compares the bidder row's email with the athlete email. | With a mandatory token the email adds nothing but a second, contradictable identity (and a new "token for another email" error). No client sends bids yet (no web bid form), so the contract change is free now. Alternative: keep `email`, require it to equal the token bidder's email, else `401 bidder_token_required`. |
| D6 | Token / bidder checks | `verify(header)` -> load bidder by id -> missing row or `tokenVersion` mismatch -> `401 bidder_token_required` (same single code as HYR-59 Q8, detail logged). Then card gate. | Token first: card is required, so a token is always required. Row load is one indexed read outside the transaction. |
| D7 | Card gate | `default_payment_method_id IS NULL` or `stripe_customer_id IS NULL` -> `403 card_required`. Also `403 card_required` when Stripe says the payment method is missing or not usable for the customer (HYR-60 Q7 detach gap). | 403 like `self_bid_not_allowed`: the caller is identified but not allowed to bid yet. The client's next step (add a card) is the same for both causes, so one code. |
| D8 | PaymentIntent shape | `amount = bid amountCents`, `currency: 'usd'`, `customer`, `payment_method = default card`, `capture_method: 'manual'`, `confirm: true`, `off_session: true`, `allowed_payment_method_types: ['card']` (stripe 23 removed `payment_method_types`), `expand: ['latest_charge']`, `metadata: { auctionId, bidderId, attemptId }` (bid id is unknown at auth time; `attemptId` is logged with the bid id after commit). Statement descriptor left to account defaults. | Off-session matches the SetupIntent `usage` (HYR-58) and needs no client-side confirmation, which the API-only endpoint cannot do. Amount is the bid itself: commission comes out of it at capture (HYR-14). US only (HYR-1 Q8), so SCA challenges are rare. |
| D9 | Idempotency key for the authorization | Random per request: `bid-hold:<attemptId>` with `attemptId = randomUUID()` generated in the usecase. | A deterministic key (auction, bidder, amount) is wrong twice: a bidder re-bidding the same amount after being outbid would get the old canceled PI back, and a double submit would share one PI, so the loser's compensating cancel would cancel the winner's hold. Random keys make each attempt its own PI; the SDK still adds its own key for network retries of that one request. |
| D10 | Authorization outcomes | Adapter returns a union, the usecase decides: `authorized` (status `requires_capture`, with `paymentIntentId`, `captureBefore: Date \| null`), `declined` (`StripeCardError`, or a PI returned in any other status such as `requires_action`; the adapter cancels only a PI returned in such a non-terminal status, and a failed cancel there is logged at `error` while the outcome stays `declined`. A card-error PI is deliberately left in `requires_payment_method`: it holds no funds and needs no extra Stripe call), `payment_method_unusable` (only a `StripeInvalidRequestError` whose `param` is `payment_method`; other invalid requests, e.g. a deleted customer, stay `422 stripe_request_rejected`). Transport / auth / unknown errors keep throwing `StripeUnavailableError` / `StripeMisconfiguredError` (502). The usecase maps `declined` -> `402 card_declined` (new `PaymentRequiredError`), `payment_method_unusable` -> `403 card_required`. Decline codes are logged, never returned. | Keeps the decision in the usecase and the SDK knowledge in the adapter. 402 is the honest status for "your card was declined"; HYR-40's 422 `stripe_request_rejected` would hide it among config errors. One code for all declines avoids a card-testing oracle. |
| D11 | Hold succeeded, bid rejected under the lock (race lost, auction closed meanwhile, ...) | Usecase cancels the new PI (`cancelHold`) and rethrows the original domain error. If the cancel fails, log `error` with the PI id and rethrow the original error anyway. No escrow row (there is no bid row to hang it on; `bid_id` is NOT NULL). | The client must see why the bid failed, not a Stripe hiccup. A failed cancel leaves an orphan hold that Stripe releases at `capture_before`; the reconciliation sweep (follow-up) can find it through PI metadata. |
| D12 | Crash between authorize and commit | Accepted orphan, same as D11's failed cancel. | No durable record exists before the bid row. An outbox / "pending hold" table would close it at the cost of a new table and a sweeper; not worth it for a process-crash window of milliseconds. Listed as a known risk. |
| D13 | `AUTHORIZED` row write | Inside the bid transaction, right after `insertLeading`, with `amountCents`, PI id, `captureBefore`. | If it were written after commit and the process died, the leader would have a hold nobody knows about and HYR-12 could not capture it. |
| D14 | Previous leader's hold lookup | Inside the transaction: `findLeading` also returns the bid's active hold (latest escrow row if `AUTHORIZED`, with PI id and amount). Returned in `PlaceBidResult.previousLeader.hold` (null for legacy bids without a hold). | Same snapshot as the demotion, no second read after commit. |
| D15 | Release-on-outbid | After commit, `EscrowTransactionService.releaseHold({ bidId, paymentIntentId, amountCents })`: `gateway.cancelHold(pi)` then insert a `VOIDED` row (insert-if-absent). Failure is logged at `error` and swallowed; the bid response is still 201. | The new bid is valid and committed; failing the request would make the client retry a bid that already succeeded. An `OUTBID` / `LOST` bid whose latest row is still `AUTHORIZED` is exactly the query the follow-up retry sweep uses; until then Stripe releases it at `capture_before`, and HYR-12 must cancel any non-winning `AUTHORIZED` hold it sees at close. |
| D16 | Cancel idempotency | Adapter `cancelHold`: on `payment_intent_unexpected_state`, retrieve the PI; `canceled` -> success, anything else -> `error` log + `StripeUnavailableError`. `VOIDED` insert is idempotent through a unique `(stripe_payment_intent_id, type)` index and `createMany({ skipDuplicates: true })`. | Retries (sweep, webhook, operator) must be safe. A PI that was captured cannot be "released"; that is a real bug and must surface. |
| D17 | Where release lives | `EscrowTransactionService.releaseHold` in `src/escrow` (service + existing `EscrowTransactionDb`), not a usecase. `EscrowModule` imports `StripeModule`. The place-bid usecase depends on `EscrowTransactionService` and `StripeGateway` (compensating cancel), never on `BidService`. | Release is short orchestration over one gateway call and one insert, reused by HYR-12 and the sweep. The usecase layer rule targets complex single operations; this is not one. |
| D18 | Schema | Migration: `escrow_transactions.capture_before TIMESTAMPTZ(3) NULL`; unique index `(stripe_payment_intent_id, type)`; plain index on `stripe_payment_intent_id` is covered by the unique one. No data migration (table is empty in every environment; nothing writes it before this ticket). | `capture_before` is what HYR-12 (and a later re-auth job) needs. Unique index gives idempotent VOIDED / CAPTURED writes. |
| D19 | Hold amount vs. later bids by the same bidder on the same auction | Not possible: `already_leading` blocks a leader from raising; after being outbid the old hold is released, and a new bid gets a new hold. | No incremental authorization needed. |
| D20 | Legacy `LEADING` / `WON` bids without a hold | Tolerated: release is a no-op when `previousLeader.hold` is null; HYR-12 must handle a `WON` bid with no `AUTHORIZED` row through the fresh-charge path. | Bids were non-binding and the API was never public, so production should have none; tests and dev data may. |
| D21 | Throttle | Unchanged, 10/min/IP. | Each bid now costs 1-2 Stripe calls; do not loosen. Card testing through bids needs a card already saved via SetupIntent (which Stripe Radar screens), plus a token. |
| D22 | `PlaceBidUsecase` structure | Stays one usecase (one operation). Validation moves into a pure `assertBiddable(snapshot, bidder, amount)` helper (`src/bids/usecases/place-bid/bid-rules.ts`) used by both preflight and the locked path. `session.upsertBidder` is removed (bidder must already exist). | Shared rules in one pure function keep the two checks identical. |

## 4. Design

### 4.1 Flow

```
controller: header X-Bidder-Token, body { amountCents }
 -> BidService.placeBid({ auctionId, bidderToken, amountCents })   (thin delegate)
 -> PlaceBidUsecase.execute
    1. amount > MAX_BID_CENTS                      -> 400 bid_above_maximum
    2. tokens.verify(header)                       -> 401 bidder_token_required
    3. db.findBidder(bidderId)  (no lock)          -> missing / version mismatch: 401 bidder_token_required
    4. card / customer missing                     -> 403 card_required
    5. db.readBiddingSnapshot(auctionId) (no lock) -> 404 auction_not_found
       assertBiddable(...)                         -> same codes as today
    6. attemptId = randomUUID()
       gateway.authorizeHold({...})                -> declined: 402 card_declined
                                                    -> payment_method_unusable: 403 card_required
                                                    -> throws 502 stripe_unavailable / stripe_misconfigured
    7. db.withLockedAuction(auctionId, (auction, session) =>
         assertBiddable(...) ; markOutbid(prev) ; insertLeading(bidder, amount)
         ; recordAuthorized(bidId, hold))
       on any throw: gateway.cancelHold(hold.paymentIntentId) (errors logged), rethrow original
    8. if previousLeader.hold: escrow.releaseHold(...)  (errors logged, swallowed)
    9. return { bid, closeAt, previousLeader }
```

Lock order is unchanged (auction row, then bids, then escrow rows). Transaction gains one insert.

### 4.2 Gateway port (`src/stripe/stripe-gateway.ts`)

```ts
export type AuthorizeHoldInput = {
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
  amountCents: Cents;
  auctionId: AuctionId;
  bidderId: BidderId;
  attemptId: string;
};

export type HoldAuthorization =
  | { outcome: 'authorized'; paymentIntentId: StripePaymentIntentId; captureBefore: Date | null }
  | { outcome: 'declined'; reason: string }
  | { outcome: 'payment_method_unusable'; reason: string };

abstract authorizeHold(input: AuthorizeHoldInput): Promise<HoldAuthorization>;
abstract cancelHold(paymentIntentId: StripePaymentIntentId): Promise<void>;
```

`reason` is for logs only (Stripe code / decline code / PI status), never sent to the client. Returned PI ids go through `stripePaymentIntentId(...)` via `brandReturnedId`; `captureBefore` from `latest_charge.payment_method_details.card.capture_before` (seconds) via `secondsToDate`, null when absent.

### 4.3 Data

`prisma/schema.prisma`, `EscrowTransaction`: add `captureBefore DateTime? @map("capture_before") @db.Timestamptz(3)` and `@@unique([stripePaymentIntentId, type])`. Migration `20261127090000_add_escrow_hold_fields`.

`PlaceBidUsecaseDb` changes:
- `findBidder(id)` -> `{ id, email: NormalizedEmail, tokenVersion, stripeCustomerId: StripeCustomerId | null, defaultPaymentMethodId: StripePaymentMethodId | null } | null` (branded through validating constructors).
- `readBiddingSnapshot(auctionId)` -> `{ auction: AuctionSnapshot, leading: LeadingBid | null } | null`, no lock, `dbNow` from `SELECT now()`.
- Session: `upsertBidder` removed; `findLeading` returns `hold: ActiveHold | null` (`{ paymentIntentId, amountCents }` when the latest escrow row is `AUTHORIZED`); new `recordAuthorized(bidId, hold)`.

`EscrowTransactionDb.recordVoided({ bidId, paymentIntentId, amountCents })` -> `createMany` with `skipDuplicates`.

### 4.4 Errors (bid endpoint, after this ticket)

| Status | Code |
|---|---|
| 400 | `validation_failed`, `auction_id_invalid`, `bid_below_minimum`, `bid_above_maximum` |
| 401 | `bidder_token_required` |
| 402 | `card_declined` |
| 403 | `card_required`, `self_bid_not_allowed` |
| 404 | `auction_not_found` |
| 409 | `auction_not_open`, `already_leading` |
| 429 | throttled |
| 502 | `stripe_unavailable`, `stripe_misconfigured` |

`PaymentRequiredError` is added to `src/common/domain-error.ts` and mapped to 402 in `DomainErrorFilter`.

### 4.5 Contract for HYR-12 (close)

- Winning bid's hold: latest `escrow_transactions` row for the `WON` bid with `type = AUTHORIZED`. Capture if `capture_before` is null or in the future; on capture failure or past `capture_before`, create a fresh `off_session` charge on `bidders.default_payment_method_id`. Write `CAPTURED` (or `FAILED`) using the `(pi, type)` unique index for idempotency. The index covers every row type: every writer (HYR-12, the `payment_intent.*` webhook, refunds) must use `skipDuplicates` or handle P2002, and at most one `REFUNDED` row exists per PaymentIntent (no multiple partial refunds without a schema change).
- Any `LOST` bid whose latest row is still `AUTHORIZED`: call `EscrowTransactionService.releaseHold`.
- Decline at close outcome (NO_SALE vs runner-up) is HYR-12's product decision.

### 4.6 Logging

`warn` for every rejected bid (existing pattern), `warn` for declines with Stripe decline code and PI id, `error` for failed compensating cancels and failed releases (PI id, bid id) so they are greppable until the sweep exists. Never log the token, client secret, card brand or last4.

## 5. Testing

- Adapter (`stripe.adapter.spec.ts`, extend the hoisted mock with `paymentIntents.create/cancel/retrieve`): request shape (manual capture, off_session, confirm, card only, expand, metadata, idempotency key), `requires_capture` -> authorized with `captureBefore`, missing `capture_before` -> null, `requires_action` -> cancels then declined, `StripeCardError` -> declined, invalid request on `payment_method` -> unusable, `resource_missing` -> unusable, other invalid request -> throws, auth error -> misconfigured, malformed PI id -> unavailable; cancel happy path, already canceled -> ok, unexpected state and not canceled -> unavailable.
- `escrow-transaction.service.spec.ts` / `.db.spec.ts`: release cancels then records VOIDED; cancel failure propagates and records nothing; `recordVoided` uses `skipDuplicates`.
- `bid-rules.spec.ts`: every rejection branch of `assertBiddable` (moved from the usecase spec).
- `place-bid.usecase.spec.ts` (nested `describe('when ...')`): token missing / invalid / version stale / bidder gone -> 401 and no Stripe call; no card -> 403 and no Stripe call; preflight rejection -> no Stripe call; declined -> 402 and no transaction; unusable -> 403; authorized + locked place succeeds -> `recordAuthorized` called with the PI and `captureBefore`, previous leader released after the transaction; locked place throws -> cancel called with the new PI and the original error rethrown; cancel also fails -> original error still rethrown; release fails -> result still returned; previous leader without hold -> no release; idempotency key differs between two calls.
- `place-bid.usecase.db.spec.ts`: query shapes for `findBidder`, `readBiddingSnapshot`, `findLeading` with hold, `recordAuthorized`.
- `place-bid.usecase.int.spec.ts` (throwaway Postgres, fake gateway + real token service): existing concurrency scenarios rewritten for seeded carded bidders; losers' holds are canceled exactly once; exactly one `AUTHORIZED` row per `LEADING` bid; outbid bid gets a `VOIDED` row; bid vs close race leaves no `AUTHORIZED` row on a bid that never committed; migration unique index rejects duplicate `(pi, type)`.
- HTTP (`bid.controller.spec.ts`, `bid-throttle.spec.ts`): header forwarded, `email` now rejected as unknown field, 402 / 401 / 403 mapping through the real filter.

## 6. Deploy and configuration

- No new env vars. Stripe dashboard: nothing required (no new webhook events in this ticket).
- Test mode: use `pm_card_visa` / `pm_card_chargeDeclined` / `pm_card_authenticationRequired` attached through the HYR-61 harness or the Stripe CLI to check the three outcomes.
- Launch gate moves: bids are binding after this ticket, but the API must still not be exposed publicly until D2's reissue ticket ships (otherwise no saved-card owner can bid).

## 7. Size and split

Estimated about 1_650 changed lines including tests (docs excluded), over the ~800 cap; backend only, guest-bidder actor plus the Stripe adapter. Four stacked backend PRs plus the docs PR:

| PR | Content | Est. lines | Depends on |
|---|---|---|---|
| D: docs | this spec + plan | ~2_700 (docs) | none |
| A: gateway holds | port types + `authorizeHold` / `cancelHold` in adapter + adapter specs | ~380 | none |
| B: escrow release | migration (`capture_before`, unique index) + schema + `EscrowTransactionDb.recordVoided` + `EscrowTransactionService.releaseHold` + `EscrowModule` imports `StripeModule` + specs + int spec for the index | ~300 | A |
| C1: token + card gate | usecase input becomes `{ auctionId, bidderToken, amountCents }`, `findBidder`, version check, card gate, `upsertBidder` removed, DTO drops `email`, controller reads header, module imports `BidderTokenModule`, specs + int spec reseeded with carded bidders, README bidding section | ~450 | none (parallel with A) |
| C2: holds in place-bid | `bid-rules.ts` extraction, preflight snapshot, authorize, `recordAuthorized` + `findLeading` hold, compensating cancel, release call, `PaymentRequiredError` + filter, specs, int spec additions, README error table | ~520 | A, B, C1 |

C1 alone makes bids require token + card but places no hold (still non-binding, like today). Schema ships with its first consumer (B), following the HYR-59 lesson about columns nobody reads. No frontend work: no bid UI exists; a web bid form is its own ticket and must send `X-Bidder-Token` and handle 401 / 402 / 403.

## 8. Known risks accepted

- Expired hold at close for early leaders (D1 option c): decline possible at close; HYR-12 owns the outcome.
- Orphan holds: process crash between authorize and commit, or a failed compensating cancel / release. Bidder funds held until `capture_before` (up to ~7 days). Mitigated by `error` logs and the follow-up sweep.
- Double hold during a lost race: two concurrent bidders both get a hold for a few hundred ms; the loser's is canceled. A cancel shows as a short pending charge on some banking apps.
- Card owner lockout (D2) until the reissue ticket ships.
- `requires_action` (SCA) is treated as a decline; US-only cards rarely trigger it. If they do, a client-side confirmation flow is its own ticket.
- `401 bidder_token_required` vs `403 card_required` reveals whether a token is valid; the token is the caller's own, so nothing new leaks.

## 9. Follow-ups (own tickets, not footnotes)

1. HYR-64: post-card-save token reissue (D2) - prerequisite for public bidding.
2. Hold reconciliation sweep: retry `releaseHold` for `OUTBID` / `LOST` bids whose latest row is `AUTHORIZED`; cancel orphan PIs found by metadata (`attemptId` with no escrow row) older than N minutes.
3. `payment_intent.canceled` / `payment_intent.payment_failed` webhook handler: record `VOIDED` / `FAILED` for automatic expiry and dashboard actions (registry already supports it; needs dashboard event subscription).
4. Re-authorize leading holds nearing `capture_before` (D1 option a upgrade), only if decline-at-close rate justifies it.
5. Web bid form (auction page): sends `X-Bidder-Token`, handles 401 / 402 / 403, reuses `GuestCardCapture`.
6. SCA / `requires_action` client confirmation, if non-US cards or issuers start challenging.
7. Cleanup: `EscrowTransactionService.hasActiveAuthorization` has no caller after this ticket either; delete or use it in HYR-12.
