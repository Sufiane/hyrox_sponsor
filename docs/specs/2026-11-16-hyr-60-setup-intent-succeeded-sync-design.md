# HYR-60: Sync bidder payment method from `setup_intent.succeeded` - Design Spec

Status: PROPOSED (decisions below are recommendations; coordinator may overrule). Date: 2026-11-16. Linear: HYR-60 (branch `hyr-60`, stacked on `hyr-59-c`).
Plan: `docs/plans/2026-11-16-hyr-60-setup-intent-succeeded-sync-plan.md`.
Depends on: HYR-58 (`StripeGateway.retrievePaymentMethod`, `StripePaymentMethodId`), HYR-59 (`bidders` card columns, `token_version`, setup-intent endpoint), HYR-1 (webhook endpoint, signature check, lease/claim dedupe, handler registry). Blocks: HYR-61 (web shows saved card), HYR-11 (holds on the saved card). Related: HYR-62 (token reissue).

## 1. Context (what exists)

- Webhook pipeline (`src/stripe/webhooks`): `POST /stripe/webhooks/platform` -> `StripeWebhookService.receive` -> `gateway.constructWebhookEvent` (signature, raw body) -> `insertIfNew` (event id unique) -> `claim` (60 s lease, `processedAt IS NULL`) -> `dispatch` to every handler whose `handles(type)` is true -> `markProcessed`. A handler throw releases the claim and returns 500, so Stripe retries. No handler for a type means the event is acked and marked processed.
- Handler precedent: `ConnectAccountUpdatedHandler` extends `StripeEventHandler`, registers itself with `StripeEventHandlerRegistry` in `onModuleInit`, and delegates to `ConnectService`. `StripeModule` exports the registry and the gateway.
- `StripeEvent.data` is the raw `event.data.object` (`Record<string, unknown>`), not branded. Setup intent payload fields used here: `id` (`seti_`), `customer` (`cus_` string, not expanded), `payment_method` (`pm_` string), `payment_method_types` (`['card']` for our intents), `usage`.
- `StripeGateway.retrievePaymentMethod(id): Promise<{ id, brand, last4, expMonth, expYear }>` already exists (HYR-58). Non-card -> `StripeUnavailableError`; unknown id -> `StripeRejectedError`; network -> `StripeUnavailableError`.
- `bidders`: `stripe_customer_id` (unique, set by HYR-59 before any setup intent is created), `default_payment_method_id`, `card_brand`, `card_last4`, `token_version INTEGER NOT NULL DEFAULT 0`, CHECK `bidders_card_all_or_none_check`.
- HYR-59 contract: tokens carry `ver`; a card holder's token is valid only while `ver == bidders.token_version`. The card write MUST bump `token_version` in the same UPDATE so pre-card tokens die when the card is saved.
- The platform webhook endpoint currently has no events subscribed (runbook section 4: "none required yet").
- Repo precedent on triggers: HYR-6 chose a service-level gate, no PG trigger (cross-table, business-rule logic). No trigger exists today.

## 2. Scope

In:
1. `StripeEventHandler` for `setup_intent.succeeded` (platform channel), parsing and branding the payload.
2. `SyncPaymentMethodUsecase` (+ own db): resolve bidder by customer id, decide, retrieve brand/last4 through the gateway, write card + `token_version + 1` in one atomic first-write-wins UPDATE.
3. Migration: `BEFORE UPDATE` trigger on `bidders` that bumps `token_version` whenever `default_payment_method_id` changes (decision Q5, separate PR).
4. Unit tests, Postgres integration tests (usecase level and webhook level), runbook + README update.

Out (own tickets): replacing a card (Q1), `payment_method.detached` / `customer.deleted` handling (Q7), `setup_intent.setup_failed`, card expiry columns, web display (HYR-61), hold on the card and token enforcement on bids (HYR-11), token reissue (HYR-62).

## 3. Open design questions and recommended decisions

| # | Question | Recommendation | Why / alternative |
|---|---|---|---|
| Q1 | Second setup intent succeeds while a card already exists: replace or ignore? | Ignore. First write wins: the UPDATE is `WHERE stripe_customer_id = $1 AND default_payment_method_id IS NULL`. A losing event is acked with a `warn` log (card id of the loser logged, no write, no version bump). Replace is a separate ticket (no ticket yet; HYR-58 follow-up "detach or replace saved card"). | (a) Replace via webhook bumps `token_version`, which kills the token of the very owner who just replaced the card, and the webhook has no way to hand them a new one (HYR-62 reissue does not exist yet). A replace flow needs its own design (synchronous confirm, token reissue in the response). (b) Replace is attractive for the pre-card race (two intents, which wins?) but first-write-wins already answers that. (c) `HYR-59` lets a token holder create another setup intent; until the replace ticket the new card is attached to the Stripe customer but not saved on the bidder. HYR-61 must not offer "change card" until then. |
| Q2 | How do we get brand and last4? | `gateway.retrievePaymentMethod(paymentMethodId)` from the usecase, before the write, outside any transaction. No port change (method exists since HYR-58). Skipped entirely when the bidder already has a card (replay and second-card paths do no Stripe call). | The event carries only the `pm_` id. Setup intent `expand` is not available on webhook payloads. A Stripe failure throws, the claim is released, Stripe retries the event (desired). Alternative: fetch inside a DB transaction. Rejected: holds a connection across a network call, buys nothing because the conditional UPDATE is already atomic. |
| Q3 | Non-card payment methods | Defense in depth: the handler acks and `warn`-logs unless `payment_method_types` is exactly `['card']`; the gateway also rejects non-card (`StripeUnavailableError`). | Card-only is enforced at setup-intent creation (HYR-58), so this should never fire. The handler check avoids an infinite retry loop (gateway error would be retried for ~3 days) if it ever does. |
| Q4 | Bidder lookup: customer id or setup-intent metadata? | Customer id: `bidders.stripe_customer_id` (unique, indexed by the unique constraint). | Our server created the customer and attached it before the first setup intent exists (HYR-59 order), so the row is always there when the event arrives. Metadata would need an adapter change (HYR-58 Q9 chose none), would not cover intents already created, and is just a second copy of the same fact. Customer id is also a stronger anchor: metadata can be set by any API caller of the Stripe account, the customer id binds to our own row. |
| Q5 | Enforce `token_version` bump: app code only, or also a DB trigger? | Both. App: the write explicitly sets `tokenVersion: { increment: 1 }` in the same UPDATE (visible, works without the trigger, matches the HYR-59 contract). DB: migration adds `BEFORE UPDATE` trigger `bidders_bump_token_version` that, whenever `default_payment_method_id` changes (including to NULL), sets `NEW.token_version := OLD.token_version + 1` (absolute from OLD, so the explicit app increment and the trigger never double-bump). Trigger ships in its own small PR. | Evaluation. For: the invariant is security-critical and will have more writers (replace card, detach handler, admin SQL, HYR-62); a forgotten bump re-opens the squatting hole silently; single-row, deterministic, no cross-table logic (unlike HYR-6, where a trigger would have carried business rules). Against: hidden behaviour (a reader of the app code does not see it), Prisma does not model triggers (same as the existing CHECK, covered by a comment in the migration plus tests), one more thing in migrations. The absolute form removes the double-bump hazard, which was the main practical downside. Alternative considered: trigger only, drop the app increment. Rejected because the HYR-59 contract and the reader of the usecase db should see the version bump where the card is written. Alternative: app only. Acceptable if the coordinator wants zero DB logic; accepted risk is a future writer forgetting the bump. |
| Q6 | Unknown customer / unmatched bidder; missing `customer`; malformed ids | Ack with log, no write, no throw: unknown customer id `warn`; `customer` null or not a string `warn`; malformed `customer` / `payment_method` / `id` (validating constructors throw) `error` log. | A retry cannot fix any of these (the row is created before the intent, see Q4), so throwing only creates a 3-day retry storm and hides the real signal. Stripe CLI `stripe trigger setup_intent.succeeded` creates its own customer and so hits the unknown-customer path, which is the safe outcome. The `error` level for malformed ids flags a real contract break (e.g. webhook API version drift, see Q9). |
| Q7 | `payment_method.detached` (and `customer.deleted`) in scope? | Out. Follow-up ticket "clear bidder card on `payment_method.detached`": null the three columns (trigger bumps the version for free) with the same first-class idempotency. | No detach API or UI exists, so the only source is the Stripe dashboard (operator action). HYR-60 is the sync-in path. Risk until the follow-up: a detached card id stays on the row and HYR-11's hold on it fails at bid time, so HYR-11 must treat a Stripe "no such payment method / not attached" error as "card required", not 500. |
| Q8 | Replay, idempotency, ordering | Three layers: (1) event id dedupe + lease (existing); (2) `WHERE default_payment_method_id IS NULL` makes the write a no-op after the first success, even for a redelivery under a new event id or a crash between UPDATE and `markProcessed`; (3) pre-read short-circuit: bidder already has the same pm -> debug `already_saved`, different pm -> warn `ignored_existing_card`, neither calls Stripe. Out-of-order delivery of events for different intents resolves by "whichever is processed first wins"; no timestamp comparison is used. Two events racing for one bidder: Postgres serialises the conditional UPDATE, loser matches 0 rows, re-reads, classifies as `ignored_existing_card`. | Event `created` ordering is not guaranteed by Stripe and carries no meaning for first-write-wins, so it is not used. |
| Q9 | Deploy / Stripe configuration change | No env var, no code config. Required dashboard change: add event `setup_intent.succeeded` to the **platform** webhook endpoint (scope "Your account") in every mode (test and live), and make sure the endpoint's API version matches the adapter's pinned `2026-10-28.endive` (or is at least payload-compatible for `setup_intent`). Update runbook section 4 and section 9 checklist in the PR. Without the subscription nothing syncs: bidders never get a card and HYR-11 cannot hold. | Local: `stripe listen --forward-to localhost:3000/stripe/webhooks/platform`, then confirm a real intent through HYR-59 (CLI `trigger` uses a foreign customer, see Q6). Deploy order: code can merge before the subscription (no events arrive); subscribe after the code is deployed so no event is acked-and-lost by an old build. |
| Q10 | Where does the logic live | Usecase layer (decided by multiple branches: resolve, classify, retrieve, write, lost-race re-read). `src/bidders/usecases/sync-payment-method/` (`sync-payment-method.usecase.ts`, `.usecase.db.ts`, `.module.ts`). Call direction: `SetupIntentSucceededHandler` (event adapter, controller-like) -> `BidderService.syncPaymentMethod` (thin delegate) -> usecase -> usecase db. The handler lives in `src/bidders/` next to the other bidder wiring, like `ConnectAccountUpdatedHandler` next to `ConnectService`. The usecase db is a full physical db (no interim shortcut): it only needs `findByStripeCustomerId` and `saveFirstCard`, nothing is entangled with `BidderDb`. | Handler stays a thin parser (event -> command). Prisma only in the usecase db. |
| Q11 | Invalid last4 / brand from Stripe | Usecase guards `last4` against `^[0-9]{4}$` and non-empty `brand` before the write; failure -> `error` log, ack, no write. | The CHECK constraint would reject it with a thrown error and a retry storm; the card data is permanent for that payment method. |

## 4. Design

### 4.1 Handler (`src/bidders/setup-intent-succeeded.handler.ts`)

`SetupIntentSucceededHandler extends StripeEventHandler implements OnModuleInit`. `handles(type) = type === 'setup_intent.succeeded'`. `onModuleInit` registers with the registry. `handle(event)` parses `event.data` with a pure function `parseSetupIntentSucceeded(data)` in the same file (not exported to other layers) returning `SyncPaymentMethodCommand | null`, logging the skip reason:

- `payment_method_types` not exactly `['card']`: warn, null.
- `customer` missing or not a string: warn, null.
- `payment_method` missing or not a string: warn, null.
- any of `id`, `customer`, `payment_method` failing `stripeSetupIntentId` / `stripeCustomerId` / `stripePaymentMethodId`: error, null (the validating constructors are the brand boundary for event payload data, no blind cast).

On a command: `await bidders.syncPaymentMethod(command)`. Handler never throws for permanent conditions; usecase/gateway errors propagate so the service releases the claim.

Note: the handler runs for events on either channel, but `setup_intent.succeeded` on the connect endpoint would be a Connect account's own intent. The handler ignores events with `event.accountId != null` (debug log), so connected-account intents can never touch a bidder.

### 4.2 Usecase (`sync-payment-method.usecase.ts`)

```
type SyncPaymentMethodCommand = { setupIntentId: StripeSetupIntentId; customerId: StripeCustomerId; paymentMethodId: StripePaymentMethodId }
type SyncPaymentMethodOutcome = 'saved' | 'already_saved' | 'ignored_existing_card' | 'unknown_customer' | 'invalid_card_data'

execute(command): Promise<SyncPaymentMethodOutcome>
 1. bidder = db.findByStripeCustomerId(customerId)            // null -> warn, 'unknown_customer'
 2. if bidder.defaultPaymentMethodId != null -> classify(bidder, pm)   // 'already_saved' | 'ignored_existing_card'
 3. card = gateway.retrievePaymentMethod(pm)                   // errors propagate -> retry
 4. if !/^[0-9]{4}$/.test(card.last4) or brand empty -> error log, 'invalid_card_data'
 5. written = db.saveFirstCard({ customerId, paymentMethodId, brand, last4 })   // one UPDATE, count > 0
    written -> info log (bidder id, last4 never logged beyond that), 'saved'
 6. lost race: bidder = db.findByStripeCustomerId(customerId); classify
```

Logging: `Logger` in the usecase, ids only (setup intent, customer, payment method, bidder id). Never brand/last4 below `info`. Never anything from the webhook body beyond ids.

### 4.3 Usecase db (`sync-payment-method.usecase.db.ts`, only Prisma importer)

```ts
findByStripeCustomerId(customerId: StripeCustomerId): Promise<Bidder | null>   // findUnique on the unique column
saveFirstCard(input): Promise<boolean> // updateMany({ where: { stripeCustomerId, defaultPaymentMethodId: null },
                                       //   data: { defaultPaymentMethodId, cardBrand, cardLast4, tokenVersion: { increment: 1 } } }).count > 0
```

One SQL UPDATE: Postgres evaluates the `IS NULL` predicate and the increment atomically per row, concurrent writers serialise on the row lock and the loser re-evaluates the predicate (READ COMMITTED), matches nothing, returns count 0.

### 4.4 Trigger migration (`prisma/migrations/20261116090000_add_bidder_token_version_trigger/migration.sql`)

```sql
-- Hand-written: any change of the default payment method invalidates bidder tokens (HYR-59 Q15), whoever writes it.
CREATE FUNCTION "bump_bidder_token_version"() RETURNS trigger AS $$
BEGIN
  IF NEW."default_payment_method_id" IS DISTINCT FROM OLD."default_payment_method_id" THEN
    NEW."token_version" := OLD."token_version" + 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bidders_bump_token_version"
BEFORE UPDATE ON "bidders"
FOR EACH ROW EXECUTE FUNCTION "bump_bidder_token_version"();
```

Interaction with the existing HYR-59 int spec: its `giveCard` helper writes `token_version + 1` explicitly; the absolute trigger leaves the result at `OLD + 1`, unchanged. `prisma migrate diff` stays empty (triggers/functions are not modelled, same as CHECK constraints).

### 4.5 Module wiring

`SyncPaymentMethodModule` (imports `StripeModule`; provides usecase + db; exports usecase). `BiddersModule` imports `SyncPaymentMethodModule` and `StripeModule`, provides `SetupIntentSucceededHandler`. `BidderService` gains a delegate `syncPaymentMethod(command)`.

### 4.6 Errors and HTTP

No HTTP surface. Webhook still answers 200 (acked/no-op) or 500 `stripe_webhook_handler_failed` (usecase threw: Stripe unavailable/rejected/misconfigured, or DB error), which releases the claim for Stripe's retry.

### 4.7 Docs

Runbook section 4: platform endpoint row events `setup_intent.succeeded`; section 9: checklist item; local-dev note on `stripe trigger` hitting `unknown_customer`. README short "Bidder card sync (HYR-60)" section: event, first-write-wins, version bump, outcomes.

## 5. Testing

- `setup-intent-succeeded.handler.spec.ts`: `handles` table; registers on init; each skip reason (nested `describe('when ...')`): wrong `payment_method_types`, missing/non-string customer, missing payment method, malformed `pm_`/`cus_`/`seti_`, `event.accountId` set; valid event calls `syncPaymentMethod` with branded command; usecase error propagates.
- `sync-payment-method.usecase.spec.ts` (mockDeep db/gateway): unknown customer; bidder has same card; bidder has other card (no gateway call in both); no card -> gateway then `saveFirstCard` with exact args -> `saved`; lost race then same pm -> `already_saved`; lost race other pm -> `ignored_existing_card`; gateway rejects -> throws, no write; invalid last4 / empty brand -> `invalid_card_data`, no write.
- `sync-payment-method.usecase.db.spec.ts`: query shapes (`where` has `defaultPaymentMethodId: null`, `increment: 1`, one `updateMany` call), returns false on count 0.
- `bidder.service.spec.ts`: one delegate case.
- `sync-payment-method.usecase.int.spec.ts` (throwaway Postgres, real db, fake gateway): first event saves the three columns and `token_version` goes 0 -> 1 exactly once; replay (same call twice) leaves one bump; second pm ignored, columns and version unchanged; unknown customer writes nothing; two concurrent first events with different pm -> exactly one winner, version 1, no CHECK violation; token issued before the save no longer matches `token_version` after it.
- `bidder-token-version-trigger.int.spec.ts` (migration PR): raw UPDATE of `default_payment_method_id` bumps by 1; same UPDATE also setting `token_version = token_version + 1` still ends at +1; clearing the card bumps; updating `email` / `card_brand` only does not bump; INSERT with a card starts at 0.
- `stripe-webhook` level int (in the usecase int file or the existing `stripe-webhook.int.spec.ts` style): a signed-by-fake gateway event delivered twice through `StripeWebhookService.receive` with the real handler -> one write, second delivery acked, `processedAt` set.

## 6. Size and split

Estimated about 960 changed lines including tests, over the 800 cap, one layer (backend), one actor (system / Stripe). Split into three backend-only PRs; A is independent (B1 does not need it: its own explicit increment gives the same result), B2 follows B1:

| PR | Content | Est. lines | Depends on |
|---|---|---|---|
| A: trigger | migration + trigger int spec | ~110 | hyr-59 (branch base) |
| B: sync | handler + spec, usecase + db + module + specs, `BidderService` delegate + spec, usecase and webhook-level int spec, runbook + README | ~770 | hyr-59 (branch base) |

Pre-marked cut inside B if the real diff passes 800: end of Task 4 in the plan (usecase + db + delegate + usecase int spec, about 520 lines) becomes B1, the handler, module wiring, webhook int and docs (about 250) become B2. B1 then has no live caller until B2, so prefer one PR. Docs (spec + plan) go in their own docs commit.

## 7. Risks

- Squatting remains first-write-wins by confirm time, not by who owns the email (HYR-59 accepted). The loser's card is left on the Stripe customer, unused.
- Replace-card gap (Q1): a token holder can create another setup intent today; its card is not saved. UX risk for HYR-61, mitigated by not exposing "change card" yet.
- Detach gap (Q7): stale pm id on the bidder; HYR-11 must treat it as "card required".
- Brand/last4 fetch is a network call in the webhook path; a Stripe outage turns into 500 + retry, bounded by the 60 s lease and Stripe's retry schedule. Acceptable.
- Webhook API version drift would change payload shape; malformed ids are logged at `error`, not retried.
- Trigger is invisible to Prisma and to the app reader; mitigated by the migration comment, tests, and the explicit app increment.
- Card expiry is not stored (`expMonth`/`expYear` are returned by the gateway but there are no columns). HYR-11 will discover expired cards through a failed hold. Candidate follow-up.

## 8. Follow-ups (own tickets)

- Replace saved card (design with token reissue, builds on HYR-62).
- Handle `payment_method.detached` / `customer.deleted`: clear card columns.
- Store card expiry, if HYR-11 wants a pre-check.
- HYR-61 web: show saved card brand/last4; hide change-card.
- Deploy: subscribe `setup_intent.succeeded` on the platform endpoint in test and live mode.
