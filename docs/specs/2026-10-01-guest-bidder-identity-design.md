# HYR-4: Guest Bidder Identity Model — Design Spec

Status: Approved
Ticket: Linear HYR-4 (project "Hyrox Sponsor — MVP", milestone M0 — Foundations). Blocked by HYR-2 (merged, 01634d6).
Date: 2026-10-01

## 1. Context

The product has guest checkout: a brand or individual bids with an email and a card (Stripe), with no account and no password (HYR-2 spec, section 2). HYR-2 already shipped the skeleton: a `Bidder` table (`id`, unique `email`, nullable `stripeCustomerId`, timestamps), `Bid.bidderId` FK, `NormalizedEmail` and `BidderId` brands, and a `BidderService.getOrCreateByEmail` that upserts on the normalised email.

HYR-4 turns that skeleton into a defined identity model: what a bidder is, how it is keyed, what invariants hold, and what the rest of the system may rely on. It does not build the checkout or bid-placement flow.

Gaps in the HYR-2 skeleton this ticket closes:

1. `normalizeEmail` trims and lowercases but never validates. `"  "` or `"not-an-email"` becomes a Bidder row.
2. The lowercase invariant lives only in application code. Any other writer (script, future service, manual SQL) can insert `Jamie@x.com` next to `jamie@x.com`.
3. No way to read a bidder by id, and no way to attach a Stripe customer id. `stripeCustomerId` is not unique, so two bidders could claim one Stripe customer.
4. No documented trust boundary: an email typed into a form is an unverified claim, not proof of ownership.

## 2. Open design questions and recommended decisions

Each is stated so the coordinator can override before the plan runs.

| # | Question | Recommendation | Why |
|---|---|---|---|
| Q1 | Bidder identity key | The `NormalizedEmail` (trim + lowercase) is the natural key; `id` (cuid, `BidderId`) is the surrogate used by FKs. Already in the schema. | Matches HYR-2. Do not collapse Gmail dots or `+tags`; that is provider-specific guessing and would merge distinct people. |
| Q2 | Is the bidder's email verified (magic link / OTP)? | No, not in this ticket. A bidder is an unverified claim. Card authorization via Stripe is the real proof at bid time. | Verification only matters for granting read access ("view my bids"), which nothing in the MVP scope needs yet. It would add an email provider, token storage, expiry and rate limiting. Revisit as its own ticket when "my bids" or receipts-with-links are scheduled. |
| Q3 | Consequence of no verification | Rule for all later tickets: an email alone never grants access to any bidder data. No endpoint may look up or return bids/PII by email. | A third party can type someone else's email. Placing a bid as them is low harm (the card is theirs, the hold is on their card); reading their history would be a leak. |
| Q4 | Link to Bid | Keep `Bid.bidderId -> Bidder.id` as in HYR-2. No schema change on Bid. Bid placement (future ticket) calls `BidderService.getOrCreateByEmail` then creates the Bid. | Already correct and indexed (`Bid(bidderId)`). |
| Q5 | HTTP endpoints in scope? | No. Data and service layer only. | No controllers exist; HYR-2 deferred CORS, `ValidationPipe` and throttler to HYR-3, the first ticket with a HTTP surface. A bidder endpoint on its own has no meaningful use: bidders are created as a side effect of placing a bid. |
| Q6 | Extra Bidder fields (name, phone, blocked flag) | None now. Stripe holds name and card details. | YAGNI. A `isBlocked` flag belongs with the first abuse-handling requirement. |
| Q7 | Stripe customer linkage | Add `@unique` on `stripe_customer_id`. `attachStripeCustomer` is idempotent for the same id and a conflict (`bidder_stripe_customer_conflict`) if the bidder already has a different one. No Stripe calls in this ticket. | One Stripe customer maps to exactly one bidder. Creating the customer is the checkout ticket's job; this ticket only provides the safe place to store the id. |
| Q8 | Same email as an Athlete | Allowed. Athlete and Bidder are separate identities with separate tables. No cross-table uniqueness. | Athletes may also sponsor others. Self-bidding on one's own zone is a bid-placement rule, flagged for that ticket, not an identity rule. |
| Q9 | Where is the lowercase invariant enforced? | Both: `normalizeEmail` in code, plus a hand-written DB `CHECK (email = lower(btrim(email)))` on `bidders`. | Code gives good errors; the CHECK stops any other writer from creating case-variant duplicates. Cheap. |
| Q10 | Email validation strictness | Pragmatic: length 3-254, exactly one `@`, non-empty local part, domain containing a dot with no whitespace. Not RFC 5322. | Real validation is "Stripe/receipt email arrives". Strict regexes reject valid addresses. |
| Q11 | Deletion / CCPA erasure, email change | Out of scope. Email is immutable for a bidder in this ticket. | US-only MVP; revisit with a compliance ticket. |

## 3. Design

### 3.1 Data

Schema change to `Bidder` in `/prisma/schema.prisma`:

- `stripeCustomerId String? @unique @map("stripe_customer_id")` (Postgres allows many NULLs under a unique index).
- No new columns, no change to `Bid`.

New migration (do not rewrite the HYR-2 init migration; it is merged): `prisma/migrations/<timestamp>_bidder_identity/migration.sql` containing the unique index (generated by Prisma) and the hand-written constraint, marked `-- Hand-written`:

```sql
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));
```

Pre-launch, so no data backfill. If a dev database holds mixed-case rows, the migration fails loudly, which is the desired behavior.

### 3.2 Common (`src/common`)

- `email.ts`: `normalizeEmail(raw: string): NormalizedEmail` now trims, lowercases, then validates (Q10). Throws `InvalidValueError('email_invalid')` (a `DomainError` from `src/common/domain-error.ts`); never logs (convention for pure helpers). The type brand is unchanged.

### 3.3 Bidders module (`src/bidders`)

Hexagonal split as in HYR-2; no usecase layer (every operation is a short passthrough).

`BidderDb` (only Prisma importer), returns raw rows or `null`, no domain throws:
- `findById(id: BidderId): Promise<Bidder | null>`
- `findByEmail(email: NormalizedEmail): Promise<Bidder | null>` (exists)
- `upsertByEmail(email: NormalizedEmail): Promise<Bidder>` (exists). Prisma 6 compiles an upsert whose `where` is a single unique field matching `create` to a native `INSERT ... ON CONFLICT`, so concurrent first bids with the same email do not raise P2002. Keep the call in that shape.
- `setStripeCustomerIdIfUnset(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<Bidder | null>`: `updateMany` where `id` and `stripeCustomerId IS NULL`, then re-read; returns the current row, or null if the bidder does not exist. Conditional update avoids a read-then-write race.

`BidderService`, no ORM import:
- `getOrCreateByEmail(rawEmail: string): Promise<BidderRecord>`: normalise via `normalizeEmail` and upsert; an invalid email lets `InvalidValueError('email_invalid')` propagate (no catch/wrap in the service), and the global `DomainErrorFilter` maps it to 400.
- `getById(id: BidderId): Promise<BidderRecord>`: `NotFoundException('bidder_not_found')` with a warn log containing the id.
- `attachStripeCustomer(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<BidderRecord>`: not found -> `bidder_not_found`; already set to the same id -> return unchanged; set to a different id -> `ConflictException('bidder_stripe_customer_conflict')` with a warn log. A unique violation from another bidder owning that Stripe id surfaces as a Prisma error; the db converts nothing (no domain throws in db), so the service must not swallow it. It propagates as a 500, which is correct: it indicates a data bug in the checkout flow.

`BidderService` stays exported from `BiddersModule`. `findByEmail` on the service is deliberately not exposed (Q3).

### 3.4 Error codes

`email_invalid`, `bidder_not_found`, `bidder_stripe_customer_conflict`. All snake_case, detail goes to the logger. Pure helpers throw `DomainError` subclasses (`InvalidValueError` -> 400 via `src/common/domain-error.filter.ts`, registered as `APP_FILTER` in `AppModule`; unmapped subclasses -> 500). The filter logs the code only.

### 3.5 Testing

- `src/common/email.spec.ts`: add invalid-input cases (empty, whitespace only, no `@`, two `@`, empty local, domain without dot, over 254 chars, internal whitespace).
- `src/bidders/bidder.service.spec.ts`: nested-`describe` per branch (valid, invalid email -> `InvalidValueError`, db untouched, not found, attach: unset / same id / different id).
- DB-level constraint and unique index are verified by a one-off SQL check against local Postgres in the migration task (the repo has no DB integration test harness; adding one is out of scope).

## 4. Out of scope

- Checkout flow, Stripe customer creation, PaymentIntents, bid placement (later tickets).
- Email verification, magic links, sessions, any HTTP controller/DTO.
- Bidder blocking, deletion, email change.
- Frontend: none. This ticket is backend-only.

## 5. Risks

- A new migration on top of the single init migration: fine, because init is merged. Do not edit init.
- `normalizeEmail` becomes throwing (`InvalidValueError`, mapped to 400 by the global filter). Its only current caller is `BidderService`; athlete email normalisation was deferred to HYR-3 and will adopt the same helper.
