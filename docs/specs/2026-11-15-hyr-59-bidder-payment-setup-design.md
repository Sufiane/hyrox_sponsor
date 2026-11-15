# HYR-59: Bidder payment method columns, setup-intent endpoint and bidder token - Design Spec

Status: PROPOSED (Q2, Q3 approved; Q13 overruled to usecase layer; vertical split). Date: 2026-11-15. Linear: HYR-59 (branch `hyr-59`, stacked on `hyr-58`).
Plan: `docs/plans/2026-11-15-hyr-59-bidder-payment-setup-plan.md`.
Depends on: HYR-58 (gateway `createCustomer` / `createSetupIntent`), HYR-4 (bidder identity). Blocks: HYR-60 (webhook fills the columns), HYR-61 (web Elements), HYR-11 (bid-time hold + token enforcement). Follow-up: HYR-62 (token reissue for locked-out guests).

## 1. Context (what exists)

- `src/bidders`: `BidderDb` (`findById`, `findByEmail`, `upsertByEmail`, `setStripeCustomerIdIfUnset`), `BidderService` (`getOrCreateByEmail(rawEmail)` normalises + validates, `getById`, `attachStripeCustomer` race-safe, throws `bidder_stripe_customer_conflict`), `BiddersModule` exports `BidderService`. No controller yet.
- `Bidder` has `stripeCustomerId String? @unique`. Email is unverified, `bidders_email_normalized_check` CHECK exists.
- `StripeGateway.createCustomer({ bidderId, email })` (idempotency key `bidder-customer:<bidderId>`, 24h) and `createSetupIntent(customerId)` returning `{ id, clientSecret }`, card-only, `off_session`. `StripeModule` exports `StripeGateway`.
- Auth precedent: `@nestjs/jwt` HS256 with `JwtModule.registerAsync` per module, separate secret for staff (`STAFF_JWT_SECRET`, must differ from `JWT_SECRET`, checked in `validateEnv`), audience + issuer claims on staff tokens, `UnauthorizedException('invalid_token')`.
- `POST /auctions/:auctionId/bids` is the throttle reference: `@Throttle({ default: { limit: 10, ttl: 60_000 } })`, DTO `email` with `@IsEmail @MaxLength(254)`, global `ValidationPipe` (whitelist, forbidNonWhitelisted), global `DomainErrorFilter`.
- Global rule from HYR-4: an email alone never grants access to bidder data. This ticket enforces that for the one thing it can do (replace a card).

## 2. Scope

In:
1. Migration + Prisma fields: `defaultPaymentMethodId`, `cardBrand`, `cardLast4` on `bidders` (all nullable).
2. Bidder token: signed, short-lived, bound to the bidder id, branded type `BidderToken`, signing and verifying in a `BidderTokenService` (no ORM import).
3. `POST /bidders/setup-intents`: find or create bidder, lazily create the Stripe customer, create setup intent, return client secret + bidder token. Requires a valid token when the bidder already has a saved card.
4. Throttle like the bid endpoint, unit + integration tests, README section, env docs.

Out: writing the three card columns (HYR-60), token enforcement on bids and "card required" gate (HYR-11), token reissue / magic link (HYR-62), web (HYR-61), detach/replace card API.

## 3. Open design questions and recommended decisions

Each is resolved on judgment; the coordinator may overrule before the plan runs.

| # | Question | Recommendation | Why / alternative |
|---|---|---|---|
| Q1 | Token format | JWT HS256 through the existing `@nestjs/jwt`, claims `sub = bidderId`, `aud = hyrox-bidder`, `iss = hyrox-api`, `iat`, `exp`. | Zero new deps, mirrors staff tokens, library handles expiry and algorithm pinning. Hand-rolled HMAC is less code to read but re-implements verification; paseto/opaque DB tokens add a dep or a table. Tokens are stateless, so no server-side revocation (accepted; TTL bounds it). |
| Q2 | Secret | New env `BIDDER_JWT_SECRET` (min 32 chars), required, must differ from `JWT_SECRET` and `STAFF_JWT_SECRET` (extend `validateEnv`). | Hard isolation: a bidder token can never verify as an athlete or staff token and vice versa, even if audience checks regress. Cost: one new required env var, so deploy config must add it before this ships (app refuses to boot otherwise, same as staff secret). Alternative: reuse `JWT_SECRET` with the audience claim only (no deploy change, weaker isolation). |
| Q3 | TTL | New env `BIDDER_TOKEN_TTL_SECONDS`, default `86_400` (24 h), min 1. Each successful setup call issues a fresh token (sliding). | Ticket says short-lived. 1 h is safer but, with no reissue until HYR-62, every returning guest with a card is locked out after an hour; 24 h covers one bidding session across the day. Web keeps the token in memory/sessionStorage; a page reload that loses it locks the guest out regardless of TTL (accepted, HYR-62). One-line config change if the user wants 1 h. |
| Q4 | Transport | Request header `X-Bidder-Token: <jwt>` on the setup endpoint; response body field `bidderToken`. | Not `Authorization: Bearer`, so it never collides with an athlete JWT on the same web session and `JwtAuthGuard` ignores it. Keeps the token out of the DTO and out of validation-failure logs. HYR-11 reads the same header. CORS needs no change (`enableCors` reflects requested headers; web goes through the BFF anyway). |
| Q5 | Route | `POST /bidders/setup-intents`, body `{ "email": string }`. Public, no auth guard. | Resource-style noun, sits next to future bidder routes. |
| Q6 | Response | `201 { clientSecret, bidderToken, bidderTokenExpiresAt }` (ISO). `Cache-Control: no-store`. Never returns bidder id, customer id, card brand/last4. | Mirrors "bid response never carries bidder identity". `no-store` because the body holds two secrets. The client secret is never logged. |
| Q7 | "Has a saved card" | `defaultPaymentMethodId != null` (the column HYR-60 writes). | A setup intent that was created but never confirmed leaves the column null, so abandoned attempts do not lock the email. |
| Q8 | Token failure code | One code, `bidder_token_required`, HTTP 401, for missing, malformed, expired, wrong audience and token-for-another-bidder. Detail logged (never the token). | Single code gives an attacker nothing about why. Matches the ticket text. Note: the 401 itself reveals that the email has a card; accepted, same class as the known `already_leading` leak, limited by the throttle. |
| Q9 | Throttle | `@Throttle({ default: { limit: 10, ttl: 60_000 } })` per IP, a local constant in the new controller (not imported from the bid controller). | "Like the bid endpoint". Each call can hit Stripe twice, so do not loosen. Same in-memory-per-instance and `TRUST_PROXY_HOPS` caveats as bids. |
| Q10 | Email normalisation / lookup | Reuse `BidderService.getOrCreateByEmail(rawEmail)` (normalises, validates, upserts with `ON CONFLICT`). No new lookup is exposed (HYR-4 Q3). | Nothing new needed. DTO gets `@IsEmail @MaxLength(254)` like `PlaceBidDto`. |
| Q11 | Existing Stripe customer | If `bidder.stripeCustomerId` is set, never call `createCustomer`; use it. Else `createCustomer` then `attachStripeCustomer`. A concurrent first call hits the same Stripe idempotency key, gets the same `cus_` id, and `attachStripeCustomer` is a no-op for an identical id. A different id surfaces as `409 bidder_stripe_customer_conflict`. | Honors the HYR-58 follow-up. Orphan Stripe customers are only possible if attach fails after the 24 h key lifetime; accepted. |
| Q12 | Idempotency of the endpoint | Not idempotent by design: every call creates a fresh setup intent and a fresh token. Customer creation is idempotent. | Matches the HYR-58 decision (no setup-intent idempotency key). |
| Q13 | Where does the orchestration live | OVERRULED by user: usecase layer. `src/bidders/usecases/create-payment-setup/create-payment-setup.usecase.ts` (`execute`) + `create-payment-setup.usecase.db.ts` (only ORM importer, narrow queries) + `create-payment-setup.module.ts` (pattern of `PlaceBidModule`). Call direction: `BidderController` -> `BidderService.createPaymentSetup` (thin delegate) -> usecase -> usecase db. The usecase never calls `BidderService`; it normalises with the common constructors (`normalizeEmail`, `bidderId`, `stripeCustomerId`) and re-implements the race-safe attach in its own db. | The flow has several rules (token gate, lazy customer, attach race, token issue) that belong to one operation. No interim shortcut: `BidderDb` and `BidderService.attachStripeCustomer` are untouched and not entangled, so the usecase db is a full physical copy of the two queries it needs. The duplication (upsert by email, conditional customer-id write) is accepted; follow-up candidate: once HYR-11 settles, check whether `BidderService.attachStripeCustomer` still has any caller and delete it if not. |
| Q14 | Column constraint | Hand-written CHECK: all three columns null, or `default_payment_method_id` and `card_brand` non-null and `card_last4 ~ '^[0-9]{4}$'`. | Cheap guard for HYR-60 / HYR-11 readers that never want a half-written card. Not branded in the DB layer yet; HYR-60 / HYR-11 brand `StripePaymentMethodId` at their I/O boundary. |
| Q15 | Token invalidation when a card is saved | `bidders.token_version INTEGER NOT NULL DEFAULT 0`; the token carries claim `ver`. A card-holder's token is valid only while `ver === bidder.tokenVersion`. HYR-60 MUST write `default_payment_method_id`, `card_brand`, `card_last4` and `token_version = token_version + 1` in ONE atomic UPDATE. | Without it, a token issued to an attacker before the owner saved a card keeps working after the card exists (squatting survives card save). Cost: one column and a version compare. Alternative considered: compare `iat` against a `card_saved_at` column (clock-dependent, same column cost). |

### Known risks accepted with this design

- Squatting: before a bidder has a card, anyone typing the email gets a token and can attach their own card; the real owner then needs the token (locked out until HYR-62). Same trust model as HYR-4 (unverified email); the loss is a blocked bid, not a leak.
- Race window: between setup-intent creation and the HYR-60 webhook the column is still null, so a second caller can obtain a token and a second setup intent for the same customer. HYR-60 decides which confirmed card becomes default (recommend: first write wins, `WHERE default_payment_method_id IS NULL`).
- No revocation before a card exists: a leaked token is valid until `exp`. Once a card is saved, the HYR-60 version bump kills every earlier token. HYR-11 reads `BidderTokenService.verify` (returns `{ bidderId, tokenVersion }`) and MUST also compare `tokenVersion` with the bidder row.
- Race: a card can land between the first read and token issue. The usecase re-reads the row (`findById`) right after the setup intent and, if the bidder now has a card and the request carried no token matching the new version, rejects instead of issuing.
- `stripeCustomerId(...)` validating constructor runs on a stored value; corrupt data yields `400 stripe_customer_id_invalid`, which is really a data bug. Acceptable.

## 4. Design

### 4.1 Data

`prisma/schema.prisma`, model `Bidder`:

```prisma
defaultPaymentMethodId String? @map("default_payment_method_id")
cardBrand              String? @map("card_brand")
cardLast4              String? @map("card_last4")
tokenVersion           Int     @default(0) @map("token_version")
```

Migration `prisma/migrations/20261115090000_add_bidder_payment_method/migration.sql`: the four `ADD COLUMN` statements (three `TEXT`, `token_version INTEGER NOT NULL DEFAULT 0`) (Prisma-generated shape) plus the `-- Hand-written` CHECK from Q14. Drift check: `prisma migrate diff` from migrations to schema must be empty (CHECK constraints are not modelled in the schema, same as the email check).

### 4.2 Common

`src/common/bidder-token.ts`: `export type BidderToken = Brand<string, 'BidderToken'>` and `bidderToken(value: string): BidderToken` (trim, non-empty, max 2048, three dot-separated base64url segments, else `InvalidValueError('bidder_token_invalid')`). Called only by `BidderTokenService` at the signing boundary.

### 4.3 Token service (`src/bidders/bidder-token.service.ts`, `bidder-token.config.ts`)

- `BidderTokenConfig` reads `BIDDER_TOKEN_TTL_SECONDS` (like `StaffAuthConfig`).
- `issue(id: BidderId, tokenVersion: number): Promise<{ token: BidderToken; expiresAt: Date }>`: `signAsync({ sub: id, ver: tokenVersion }, { algorithm: 'HS256', expiresIn, audience, issuer })`.
- `verify(raw: string | undefined): Promise<{ bidderId: BidderId; tokenVersion: number }>`: undefined / empty / verify failure / missing `sub` / missing, non-integer or negative `ver` -> warn log (no token text) + `UnauthorizedException('bidder_token_required')`; success -> `{ bidderId(payload.sub), payload.ver }`.
- Lives in its own `BidderTokenModule` (`src/bidders/bidder-token.module.ts`: `JwtModule.registerAsync` with `BIDDER_JWT_SECRET`, `BidderTokenConfig`, `BidderTokenService`, exports the service). Separate module so both the usecase module and HYR-11's bid module can import it without a cycle with `BiddersModule`. `BiddersModule` imports and re-exports it.

### 4.4 Usecase (`src/bidders/usecases/create-payment-setup/`)

`BidderService.createPaymentSetup(input)` is a one-line delegate to `CreatePaymentSetupUsecase.execute(input)`. Usecase depends on `CreatePaymentSetupUsecaseDb`, `StripeGateway`, `BidderTokenService`.

```
execute({ email: string, bidderToken: string | undefined }): Promise<PaymentSetupResult>
 1. email = normalizeEmail(raw)                              // email_invalid -> 400
 2. bidder = db.upsertByEmail(email)
 3. if bidder.defaultPaymentMethodId != null:
      verified = tokenService.verify(bidderToken)
      if verified.bidderId !== bidder.id or verified.tokenVersion !== bidder.tokenVersion
        -> warn (mismatch kind, never the token) + 401 bidder_token_required
 4. customerId = bidder.stripeCustomerId ?? createCustomer + attach (below)
 5. setupIntent = gateway.createSetupIntent(customerId)
 6. current = db.findById(id)                              // re-read; if it now has a card and the version/card changed since step 2, repeat the step 3 check
    issued = tokenService.issue(id, current.tokenVersion)
 7. return { clientSecret, bidderToken, bidderTokenExpiresAt }
```

Attach (re-implemented, simpler than `attachStripeCustomer`): `row = db.setStripeCustomerIdIfUnset(id, created)` runs `updateMany where id and stripeCustomerId IS NULL` then re-reads. `row == null` -> `bidder_not_found` (warn); `row.stripeCustomerId !== created` -> `ConflictException('bidder_stripe_customer_conflict')` (warn); equal covers both "we wrote it" and "a concurrent call wrote the same Stripe id".

Usecase db (only Prisma importer in the folder): `upsertByEmail(email: NormalizedEmail): Promise<Bidder>` (single-unique-field upsert, `ON CONFLICT` shape, as in `BidderDb`) and `setStripeCustomerIdIfUnset(id: BidderId, customerId: StripeCustomerId): Promise<Bidder | null>`.

Ordering: the token check precedes any Stripe call, so a rejected request costs no Stripe call and creates no customer.

### 4.5 Controller (`src/bidders/bidder.controller.ts`, `dto/create-setup-intent.dto.ts`, `setup-intent-response.ts`)

Thin: `@Post('setup-intents') @Throttle(...) @Header('Cache-Control', 'no-store')`, `@Headers('x-bidder-token')`, delegates to `BidderService.createPaymentSetup`, maps result to `{ clientSecret, bidderToken, bidderTokenExpiresAt: iso }`.

### 4.6 Config and docs

`env.validation.ts`: `BIDDER_JWT_SECRET`, `BIDDER_TOKEN_TTL_SECONDS`, distinct-secret checks. `.env.example` updated. README section "Bidder payment setup (HYR-59)" with route, header, response, error table, throttle, env, and the "enforcement on bids is HYR-11" note.

### 4.7 Errors

| Status | Code |
|---|---|
| 400 | `validation_failed`, `email_invalid` |
| 401 | `bidder_token_required` |
| 409 | `bidder_stripe_customer_conflict` |
| 422 | `stripe_request_rejected` |
| 429 | throttled |
| 502 | `stripe_unavailable`, `stripe_misconfigured` |

## 5. Testing

- `bidder-token.service.spec.ts`: sign/verify round trip; expired (fake timers), wrong secret, wrong audience, missing sub, undefined, garbage; never logs the token.
- Token isolation spec: bidder token rejected by `JwtAuthGuard` / `StaffGuard`; athlete and staff tokens rejected by `BidderTokenService.verify` (extends the existing isolation pattern).
- `create-payment-setup.usecase.spec.ts` (mockDeep db/gateway/token, nested `describe('when ...')`; adds attach cases: write returns null -> `bidder_not_found`, other customer id -> `bidder_stripe_customer_conflict`) plus `create-payment-setup.usecase.db.spec.ts` (query shapes, pattern of `place-bid.usecase.db.spec.ts`) and a one-case delegate test in `bidder.service.spec.ts`: no card + no customer; no card + existing customer; card + no token; card + valid token; card + token for other bidder; card + expired token; attach conflict; Stripe error propagates and no token issued; Stripe never called when the token is rejected.
- Controller spec with real Nest app (pattern of `bid-throttle.spec.ts`): 201 shape + `no-store`, header wiring, 11th call in a minute is 429, unknown body field -> 400.
- `create-payment-setup.usecase.int.spec.ts` (Postgres throwaway DB, real usecase db + `BidderTokenService`, fake gateway): new email end to end; second call reuses customer (one `createCustomer`); two concurrent first calls store one customer id; card present (set by raw SQL) rejects without token, accepts valid token, rejects another bidder's token; CHECK constraint rejects half-written card columns.
- Env spec: new vars required, defaults, distinct secrets.

## 6. Size and split

Estimated about 1_150 changed lines including tests (token ~360, rest ~790), over the 800 cap for one PR. Revised split after review: the earlier A/B cut (schema + token first) shipped columns nothing consumed. New split is vertical, both PRs backend-only, public guest actor, stacked:

| PR | Content | Est. lines | Depends on |
|---|---|---|---|
| A: bidder token | `BidderToken` brand + spec, `BidderTokenConfig`, `BidderTokenService` + spec, `BidderTokenModule`, `BIDDER_JWT_SECRET` / `BIDDER_TOKEN_TTL_SECONDS` env + validation + spec + `.env.example`, isolation spec | ~360 | hyr-58 (branch base only) |
| B: setup endpoint | migration + columns + CHECK, usecase + usecase db + module + specs, `BidderService.createPaymentSetup` delegate + spec, controller + DTO + response mapper, controller/throttle spec, int spec, README | ~790 | A |

PR A is standalone and reusable by HYR-11 (`verify`); it is consumed in B, with no schema in it. PR B is the whole user-visible slice: columns exist because the usecase reads `defaultPaymentMethodId` for the gate, and the int spec covers them.

Three-way option, not recommended: B1 = migration + usecase + db + delegate + int spec (~480, no HTTP surface, columns consumed only by the usecase), B2 = controller + DTO + throttle spec + README (~310). Better balance (360/480/310) and B is far from the cap, but B1 has no caller until B2 merges. PR B at ~790 sits at the cap; if the real diff exceeds 800, cut at the pre-marked line in the plan (end of Task 8, controller work becomes PR C).

Docs (spec + plan, ~450 lines) go in their own `docs` commit or PR. No frontend work: HYR-61 consumes the endpoint.

## 7. Follow-ups (own tickets, not footnotes)

- HYR-62: token reissue for locked-out guests (already filed; blocks HYR-32 pre-deploy).
- HYR-11: enforce `verify` on bids, "card required" gate; compare the returned `tokenVersion` with `bidders.token_version`.
- HYR-60: fill the three columns AND `token_version = token_version + 1` in one atomic UPDATE; decide default-card write rule (first write wins).
- Deploy config: add `BIDDER_JWT_SECRET` (and optional `BIDDER_TOKEN_TTL_SECONDS`) to every environment before merging PR A to a deployed branch.
