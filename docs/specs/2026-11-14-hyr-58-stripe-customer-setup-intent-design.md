# HYR-58: Stripe customer, setup intent and payment method on the gateway port - Design Spec

Status: PROPOSED. Date: 2026-11-14. Linear: HYR-58 (branch `hyr-58`).
Plan: `docs/plans/2026-11-14-hyr-58-stripe-customer-setup-intent-plan.md`.
Depends on: HYR-1 (port + adapter, merged). Blocks: HYR-59 (setup endpoint), HYR-60 (`setup_intent.succeeded` webhook), HYR-61 (web Stripe Elements), HYR-11 (per-bid holds on the saved card).

## 1. Context

- `src/stripe/stripe-gateway.ts` is an abstract class (the port). `src/stripe/stripe.adapter.ts` is the only file importing the SDK and `implements` the port (stripe 23.1.0, API version `2026-10-28.endive`, retries 2, timeout 20s).
- All SDK calls go through `StripeAdapter.call(operation, run)`, which maps failures: auth/permission -> `StripeMisconfiguredError` (`stripe_misconfigured`), card/invalid-request/idempotency -> `StripeRejectedError` (`stripe_request_rejected`), anything else -> `StripeUnavailableError` (`stripe_unavailable`). Raw messages are logged, never put in the error.
- Ids returned by Stripe are branded inside the adapter through validating constructors; a malformed id is logged and mapped to `StripeUnavailableError`.
- `src/common/stripe-ids.ts` has `StripeCustomerId` (`cus_`) already, no setup intent / payment method brands.
- `Bidder.stripeCustomerId` (unique, nullable) and `BidderService.attachStripeCustomer` (race-safe) exist. Not touched here.
- Tests mock `stripe` with `vi.hoisted` + `vi.mock('stripe')`, nested `describe('when ...')`. Other specs fake the gateway with `mockDeep<StripeGateway>()` or `as unknown as StripeGateway`, so adding abstract methods breaks no existing code.

## 2. Scope

In: three new port methods + adapter implementations, two new branded ids with validating constructors, adapter unit tests.
Out: endpoints, DB/migrations (attaching the customer id to the bidder), webhook handler, web UI, PaymentIntent/hold methods (HYR-11), detaching/replacing cards.

## 3. Design

### 3.1 Ids (`src/common/stripe-ids.ts`)

- `StripeSetupIntentId`, constructor `stripeSetupIntentId`, prefix `seti_`, code `stripe_setup_intent_id_invalid`.
- `StripePaymentMethodId`, constructor `stripePaymentMethodId`, prefix `pm_`, code `stripe_payment_method_id_invalid`.
- Same `prefixedStripeId` helper (trim, prefix, non-empty after prefix, max 255). Casting to the brand happens only in the adapter, via these constructors.

### 3.2 Port additions (`stripe-gateway.ts`)

```ts
export type CreateCustomerInput = { bidderId: BidderId; email: NormalizedEmail };
export type SetupIntentHandle = { id: StripeSetupIntentId; clientSecret: string };
export type PaymentMethodSnapshot = {
  id: StripePaymentMethodId;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

abstract createCustomer(input: CreateCustomerInput): Promise<StripeCustomerId>;
abstract createSetupIntent(customerId: StripeCustomerId): Promise<SetupIntentHandle>;
abstract retrievePaymentMethod(paymentMethodId: StripePaymentMethodId): Promise<PaymentMethodSnapshot>;
```

Shapes follow consumers: HYR-59 persists the customer id and returns `clientSecret` to the web (HYR-61); HYR-60 retrieves the card by the payment method id on the webhook and stores display data; HYR-11 uses customer id + payment method id for holds. `brand` stays a plain string (Stripe's open set: visa, mastercard, ...), not branded (free-text).

### 3.3 Adapter behaviour

- `createCustomer`: `customers.create({ email, metadata: { bidderId } }, { idempotencyKey: 'bidder-customer:<bidderId>' })`. Returns branded customer id.
- `createSetupIntent`: `setupIntents.create({ customer, usage: 'off_session', allowed_payment_method_types: ['card'] })`. A null `client_secret` is logged and mapped to `StripeUnavailableError`. No idempotency key.
- `retrievePaymentMethod`: `paymentMethods.retrieve(id)`; returns brand, last4, expiry from `card`. If `card` is absent (non-card method), log and throw `StripeUnavailableError`. An unknown id makes Stripe throw `StripeInvalidRequestError`, which `call` maps to `StripeRejectedError`.
- Malformed ids from Stripe (customer, setup intent, payment method) -> logged, `StripeUnavailableError`, via one shared private helper (existing `brandAccountId` left untouched).

### 3.4 Testing

Adapter unit tests only, mirroring the existing spec: request shape, branded return, null client secret, non-card payment method, malformed ids, and the three new methods added to the existing `error mapping` `describe.each`. Id constructors added to the existing `stripe-ids.spec.ts` table.

## 4. Size and split

About 340 changed lines of code and tests (ids 12, ids spec 12, port 25, adapter 80, adapter spec 210), single backend PR, one layer, no actor-facing surface. Under the 800 cap, no split. Docs (this spec + plan) add ~400 lines; commit them as a separate `docs` commit in the same branch, or as their own PR if the reviewer wants code-only.

## 5. Risks

- Idempotency key lives 24h and Stripe rejects a reuse with different params (`StripeIdempotencyError` -> `stripe_request_rejected`). A bidder retrying within 24h with a changed email would fail. HYR-59 should create the customer once and persist it, so retries are rare.
- Duplicate Customers outside the 24h window if HYR-59 does not check `Bidder.stripeCustomerId` first. That check is HYR-59's job (`attachStripeCustomer` handles the race).
- Setup intents are single-use per card collection attempt; replays after 24h create a new one (acceptable, harmless).

## 6. Follow-ups (own tickets)

- Detach or replace saved card (no ticket yet).
- Include 3DS/`request_three_d_secure` tuning if HYR-11 shows decline issues.
- Any future caller of `retrievePaymentMethod` that takes a `pm_` id from a client must verify the payment method belongs to the bidder's own Stripe customer before using it.

## 7. Open design questions (resolved on judgment, reviewer may overrule)

1. `usage: 'off_session'`: yes, required so HYR-11 can hold without the cardholder. Stripe's default is already `off_session`; we pass it explicitly for readability and test lock-in.
2. `allowed_payment_method_types: ['card']`: yes, explicit. Auto payment methods would let wallets/bank debits in, which cannot back manual-capture holds. Widening is a deliberate later change.
3. Customer idempotency key `bidder-customer:<bidderId>`: yes, mirrors `connect-account:<athleteId>`. Keyed by bidder id not email (email can change, id is the identity).
4. Bidder id in customer metadata: yes (`bidderId`), for reconciliation from the Stripe dashboard. Customer email is `NormalizedEmail`.
5. Setup intent idempotency key: no. Retried calls are already protected by the SDK's automatic network-retry keys; a user-level retry should produce a fresh intent and client secret.
6. `retrievePaymentMethod` for unknown id: throws `stripe_request_rejected` (via `call`), not null. Its only caller (HYR-60) gets the id from Stripe's own event, so a missing one is a bug, not a normal branch. Consistent with `retrieveAccount`.
7. Non-card payment method: `stripe_unavailable` plus error log (cannot happen with card-only setup intents).
8. `createCustomer` returns the bare `StripeCustomerId`, `createSetupIntent` returns `{ id, clientSecret }` (client secret is a plain string, sensitive, never logged).
9. Setup intent `metadata`: none. HYR-60 resolves the bidder via the customer id (`Bidder.stripeCustomerId` is unique).
