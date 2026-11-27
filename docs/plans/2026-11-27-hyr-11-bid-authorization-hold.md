# HYR-11: Per-bid Stripe authorization hold + release-on-outbid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bids binding: require the bidder token and a saved card, authorize a manual-capture PaymentIntent for every accepted bid, and release the previous leader's hold when outbid.

**Architecture:** The Stripe port gains `authorizeHold` / `cancelHold` (adapter is the only SDK importer, returns a discriminated outcome). `EscrowTransactionService.releaseHold` cancels a hold and records `VOIDED`. `PlaceBidUsecase` verifies the token, gates on the card, runs an unlocked preflight with the same pure rules as the locked path, authorizes outside the row lock, writes the bid plus the `AUTHORIZED` escrow row in the locked transaction, cancels the hold if the locked place fails, and releases the previous leader after commit.

**Tech Stack:** NestJS 12 (ESM), Prisma 6 (Postgres, port 5435 locally), Vitest + `vitest-mock-extended`, `stripe@23.1.0` (API `2026-10-28.endive`), `@nestjs/jwt` (bidder token).

**Spec:** `docs/specs/2026-11-27-hyr-11-bid-authorization-hold-design.md`

**Open user decisions (spec D1, D2, D5):** this plan implements the recommendations: D1 option (c), D2 handled as a separate prerequisite ticket for public launch (nothing in this plan), D5 drop `email` from the bid body. If the user picks differently: D1 (b) deletes PR A's `authorizeHold` use and all of PR C2; D1 (a) adds a re-auth job ticket, nothing here changes; D5 "keep email" changes Task 7 only (keep the DTO field, compare it with the token bidder's email, `401 bidder_token_required` on mismatch).

## Ticket split (read first)

Backend only. Actor: guest bidder (plus the Stripe adapter). Total about 1_650 changed lines without docs, so four stacked PRs after the docs PR.

| PR | Branch | Tasks | Est. lines | Depends on |
|---|---|---|---|---|
| D: docs | `hyr-11` | spec + plan | ~2_700 docs | none |
| A: gateway holds | `hyr-11-a` (from `hyr-11`) | 1-2 | ~380 | none |
| B: escrow release | `hyr-11-b` (from `hyr-11-a`) | 3-4 | ~300 | A |
| C1: token + card gate | `hyr-11-c1` (from `hyr-11`) | 5-7 | ~450 | none, parallel with A/B |
| C2: holds in place-bid | `hyr-11-c2` (from `hyr-11-b`, rebased on `hyr-11-c1` once merged) | 8-12 | ~520 | A, B, C1 |

C1 merged alone: bids require token + card but place no hold (still non-binding, as today). A + B merged alone: methods and release exist with no caller in the bid flow (unit + int specs cover them). C2 wires everything.

## Global Constraints

- Hexagonal split: `*.service.ts` / `*.usecase.ts` never import `@prisma/client` or `src/prisma/` (enforced by `npm run lint:arch`). Only `src/stripe/stripe.adapter.ts` imports `stripe`.
- Call direction: controller -> `BidService` (thin delegate) -> `PlaceBidUsecase` -> `PlaceBidUsecaseDb`. The usecase may depend on other modules' exported services (`BidderTokenService`, `EscrowTransactionService`) and on `StripeGateway`, never on `BidService`.
- Explicit return types on every function/method. No single-letter names (except `i`/`j`/`k` in indexed loops). No inline `if`; blank line before `if`/`for`/`while`/`return`/`throw` unless first in block. No nested function declarations. No `!!`. Constructor parameter properties are `readonly`. Numeric separators on literals with 5+ digits. No barrel files. No comments unless a non-obvious why.
- Error codes are snake_case; readable detail goes to the class `Logger` at the throw site (`warn` for rejections, `error` for failed cancels/releases). Pure helpers never log. Never log the bidder token, client secret, card brand or last4.
- Branded types: `Cents`, `AuctionId`, `BidId`, `BidderId`, `NormalizedEmail`, `StripePaymentIntentId`, `StripeCustomerId`, `StripePaymentMethodId`. Cast only in `*.db.ts` / the adapter, through validating constructors (`cents`, `normalizeEmail`, `stripePaymentIntentId`, ...), never a blind `as` in production code.
- Prisma fields use snake_case `@map`.
- Tests: Vitest, a nested `describe('when ...')` per branch, `it` titles state only the outcome, shared setup in that `describe`'s `beforeEach`.
- No new dependencies, no env vars.
- Commits: Conventional Commits, lowercase imperative (`feat(stripe): add payment intent hold methods`). Per project workflow, stage and stop for the user's `/crit` before committing implementation work; commit locally only when a rebase needs it. Trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Verify before calling a task done: `npm run lint && npm run lint:arch && npm run typecheck && npm test`; for `*.int.spec.ts`: `npm run test:integration` (local Postgres on 5435).

## File structure

PR A:
- Modify `src/stripe/stripe-gateway.ts` (types + two abstract methods)
- Modify `src/stripe/stripe.adapter.ts` (+ `stripe.adapter.spec.ts`)

PR B:
- Create `prisma/migrations/<timestamp>_add_escrow_hold_fields/migration.sql`; modify `prisma/schema.prisma`
- Modify `src/escrow/escrow-transaction.db.ts` (+ create `escrow-transaction.db.spec.ts`, `escrow-transaction.db.int.spec.ts`)
- Modify `src/escrow/escrow-transaction.service.ts` (+ spec), `src/escrow/escrow.module.ts`

PR C1:
- Modify `src/bids/usecases/place-bid/place-bid.usecase.db.ts` (+ spec), `place-bid.usecase.ts` (+ spec, int spec), `place-bid.module.ts`
- Modify `src/bids/bid.controller.ts` (+ spec), `src/bids/dto/place-bid.dto.ts`, `src/bids/bid-throttle.spec.ts`, `README.md`

PR C2:
- Create `src/bids/usecases/place-bid/bid-rules.ts` (+ `bid-rules.spec.ts`)
- Modify `src/common/domain-error.ts`, `src/common/domain-error.filter.ts` (+ spec)
- Modify the place-bid usecase, usecase db, module and their specs; `src/bids/place-bid-response.spec.ts`, `src/bids/bid.controller.spec.ts`, `src/bids/bid-throttle.spec.ts`; `README.md`

---

## PR A: gateway holds

### Task 1: `authorizeHold` on the port and adapter

**Files:**
- Modify: `src/stripe/stripe-gateway.ts`
- Modify: `src/stripe/stripe.adapter.ts`
- Test: `src/stripe/stripe.adapter.spec.ts`

**Interfaces:**
- Consumes: `stripePaymentIntentId` (`src/common/stripe-ids.ts`), `Cents` (`src/common/money.ts`), `AuctionId` / `BidderId` (`src/common/ids.ts`).
- Produces (exported from `src/stripe/stripe-gateway.ts`):

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

// on StripeGateway:
abstract authorizeHold(input: AuthorizeHoldInput): Promise<HoldAuthorization>;
abstract cancelHold(paymentIntentId: StripePaymentIntentId): Promise<void>;
```

- [ ] **Step 1: Extend the SDK mock in the adapter spec**

In `src/stripe/stripe.adapter.spec.ts` add to `vi.hoisted`: `paymentIntentsCreate: vi.fn(), paymentIntentsCancel: vi.fn(), paymentIntentsRetrieve: vi.fn(),` and to `FakeStripe`:

```ts
    paymentIntents = {
      create: mocks.paymentIntentsCreate,
      cancel: mocks.paymentIntentsCancel,
      retrieve: mocks.paymentIntentsRetrieve,
    };
```

Add a helper below `stripeFailure`:

```ts
function stripeFailureWith(type: string, fields: Record<string, string>): Error {
  return Object.assign(stripeFailure(type), fields);
}
```

- [ ] **Step 2: Write the failing tests**

Append inside `describe('StripeAdapter', ...)` (import `stripePaymentIntentId` from `../common/stripe-ids`, `auctionId` from `../common/ids`, `cents` from `../common/money`):

```ts
  describe('when authorizing a hold', () => {
    const input = {
      customerId: stripeCustomerId('cus_1'),
      paymentMethodId: stripePaymentMethodId('pm_1'),
      amountCents: cents(5_500),
      auctionId: auctionId('auction-1'),
      bidderId: BIDDER,
      attemptId: 'attempt-1',
    };

    function capturable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'pi_1',
        status: 'requires_capture',
        latest_charge: { payment_method_details: { card: { capture_before: 1_764_000_000 } } },
        ...overrides,
      };
    }

    describe('when the card authorizes', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockResolvedValue(capturable());
      });

      it('creates a confirmed off-session manual-capture card intent', async () => {
        await adapter.authorizeHold(input);

        expect(mocks.paymentIntentsCreate).toHaveBeenCalledWith(
          {
            amount: 5_500,
            currency: 'usd',
            customer: 'cus_1',
            payment_method: 'pm_1',
            payment_method_types: ['card'],
            capture_method: 'manual',
            confirm: true,
            off_session: true,
            expand: ['latest_charge'],
            metadata: { auctionId: 'auction-1', bidderId: 'bidder-1', attemptId: 'attempt-1' },
          },
          { idempotencyKey: 'bid-hold:attempt-1' },
        );
      });

      it('returns the branded intent id and capture deadline', async () => {
        await expect(adapter.authorizeHold(input)).resolves.toEqual({
          outcome: 'authorized',
          paymentIntentId: stripePaymentIntentId('pi_1'),
          captureBefore: new Date(1_764_000_000_000),
        });
      });
    });

    describe('when the charge has no capture deadline', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockResolvedValue(capturable({ latest_charge: 'ch_1' }));
      });

      it('returns a null capture deadline', async () => {
        await expect(adapter.authorizeHold(input)).resolves.toMatchObject({ captureBefore: null });
      });
    });

    describe('when the intent needs customer action', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockResolvedValue(capturable({ status: 'requires_action' }));
        mocks.paymentIntentsCancel.mockResolvedValue({ id: 'pi_1', status: 'canceled' });
      });

      it('cancels the intent', async () => {
        await adapter.authorizeHold(input);

        expect(mocks.paymentIntentsCancel).toHaveBeenCalledWith('pi_1');
      });

      it('reports a decline with the status as reason', async () => {
        await expect(adapter.authorizeHold(input)).resolves.toEqual({
          outcome: 'declined',
          reason: 'requires_action',
        });
      });
    });

    describe('when the card is declined', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockRejectedValue(
          stripeFailureWith('StripeCardError', { code: 'card_declined', decline_code: 'insufficient_funds' }),
        );
      });

      it('reports a decline with the decline code as reason', async () => {
        await expect(adapter.authorizeHold(input)).resolves.toEqual({
          outcome: 'declined',
          reason: 'insufficient_funds',
        });
      });
    });

    describe('when the payment method is rejected', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockRejectedValue(
          stripeFailureWith('StripeInvalidRequestError', { code: 'resource_missing', param: 'payment_method' }),
        );
      });

      it('reports the payment method as unusable', async () => {
        await expect(adapter.authorizeHold(input)).resolves.toEqual({
          outcome: 'payment_method_unusable',
          reason: 'resource_missing',
        });
      });
    });

    describe('when the customer is missing', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockRejectedValue(
          stripeFailureWith('StripeInvalidRequestError', { code: 'resource_missing', param: 'customer' }),
        );
      });

      it('reports the payment method as unusable', async () => {
        await expect(adapter.authorizeHold(input)).resolves.toMatchObject({ outcome: 'payment_method_unusable' });
      });
    });

    describe('when another invalid request error occurs', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockRejectedValue(
          stripeFailureWith('StripeInvalidRequestError', { code: 'parameter_invalid_integer', param: 'amount' }),
        );
      });

      it('throws stripe_request_rejected', async () => {
        await expect(adapter.authorizeHold(input)).rejects.toBeInstanceOf(StripeRejectedError);
      });
    });

    describe('when the api key is wrong', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockRejectedValue(stripeFailure('StripeAuthenticationError'));
      });

      it('throws stripe_misconfigured', async () => {
        await expect(adapter.authorizeHold(input)).rejects.toBeInstanceOf(StripeMisconfiguredError);
      });
    });

    describe('when stripe returns a malformed intent id', () => {
      beforeEach(() => {
        mocks.paymentIntentsCreate.mockResolvedValue(capturable({ id: 'ch_wrong' }));
      });

      it('throws stripe_unavailable', async () => {
        await expect(adapter.authorizeHold(input)).rejects.toBeInstanceOf(StripeUnavailableError);
      });
    });
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/stripe/stripe.adapter.spec.ts`
Expected: FAIL, `adapter.authorizeHold is not a function` (and typecheck errors on the missing types).

- [ ] **Step 4: Add the port types and methods**

In `src/stripe/stripe-gateway.ts` import `AuctionId` alongside the existing id imports, `Cents` from `../common/money`, `StripePaymentIntentId` from `../common/stripe-ids`, add `AuthorizeHoldInput` and `HoldAuthorization` exactly as in **Interfaces**, and add both abstract methods to `StripeGateway` after `retrievePaymentMethod`.

- [ ] **Step 5: Implement in the adapter**

In `src/stripe/stripe.adapter.ts`:
1. Import `stripePaymentIntentId`, `type StripePaymentIntentId`, `type DomainError` (from `../common/domain-error`), `type AuthorizeHoldInput`, `type HoldAuthorization`.
2. Add constants: `const HOLD_CURRENCY = 'usd';` and `const UNUSABLE_PAYMENT_METHOD_PARAMS: ReadonlySet<string> = new Set(['payment_method', 'customer']);`
3. Replace `call` with a version built on a new `toDomainError` and add the helpers and methods below.

```ts
  async authorizeHold(input: AuthorizeHoldInput): Promise<HoldAuthorization> {
    let intent: Stripe.PaymentIntent;

    try {
      intent = await this.client.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: HOLD_CURRENCY,
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          payment_method_types: ['card'],
          capture_method: 'manual',
          confirm: true,
          off_session: true,
          expand: ['latest_charge'],
          metadata: { auctionId: input.auctionId, bidderId: input.bidderId, attemptId: input.attemptId },
        },
        { idempotencyKey: `bid-hold:${input.attemptId}` },
      );
    } catch (error) {
      return this.holdRefusal(error);
    }

    return this.toHoldAuthorization(intent);
  }

  private async toHoldAuthorization(intent: Stripe.PaymentIntent): Promise<HoldAuthorization> {
    const paymentIntentId = this.brandReturnedId('payment intent', intent.id, stripePaymentIntentId);

    if (intent.status !== 'requires_capture') {
      this.logger.warn(`Stripe hold ${paymentIntentId} ended in status ${intent.status}, canceling it`);
      await this.cancelHold(paymentIntentId);

      return { outcome: 'declined', reason: intent.status };
    }

    return { outcome: 'authorized', paymentIntentId, captureBefore: this.captureBefore(intent) };
  }

  private captureBefore(intent: Stripe.PaymentIntent): Date | null {
    const charge = intent.latest_charge;

    if (charge == null || typeof charge === 'string') {
      return null;
    }

    const seconds = charge.payment_method_details?.card?.capture_before;

    return seconds == null ? null : secondsToDate(seconds);
  }

  private holdRefusal(error: unknown): HoldAuthorization {
    const type = this.errorType(error);
    const code = this.errorField(error, 'code');

    if (type === 'StripeCardError') {
      const reason = this.errorField(error, 'decline_code') ?? code ?? 'card_error';

      this.logger.warn(`Stripe declined a hold (${reason}): ${this.describe(error)}`);

      return { outcome: 'declined', reason };
    }

    const param = this.errorField(error, 'param');

    if (type === 'StripeInvalidRequestError' && param != null && UNUSABLE_PAYMENT_METHOD_PARAMS.has(param)) {
      this.logger.warn(`Stripe refused the hold payment method (${code}, ${param}): ${this.describe(error)}`);

      return { outcome: 'payment_method_unusable', reason: code ?? 'invalid_payment_method' };
    }

    throw this.toDomainError('authorizeHold', error);
  }

  private async call<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw this.toDomainError(operation, error);
    }
  }

  private toDomainError(operation: string, error: unknown): DomainError {
    this.logger.error(`Stripe ${operation} failed: ${this.describe(error)}`);

    if (MISCONFIGURED_ERROR_TYPES.has(this.errorType(error))) {
      return new StripeMisconfiguredError();
    }

    if (REJECTED_ERROR_TYPES.has(this.errorType(error))) {
      return new StripeRejectedError();
    }

    return new StripeUnavailableError();
  }

  private errorField(error: unknown, field: 'code' | 'param' | 'decline_code'): string | null {
    if (!(error instanceof Error) || !(field in error)) {
      return null;
    }

    const value: unknown = (error as unknown as Record<string, unknown>)[field];

    return typeof value === 'string' ? value : null;
  }
```

`cancelHold` is implemented in Task 2; add a temporary body in this step so the class compiles and Task 1's "requires_action" test passes:

```ts
  async cancelHold(paymentIntentId: StripePaymentIntentId): Promise<void> {
    await this.call('cancelHold', () => this.client.paymentIntents.cancel(paymentIntentId));
  }
```

Also update every fake `StripeGateway` that `implements`/is cast from the class with `as unknown as StripeGateway`: no change needed (casts); `mockDeep<StripeGateway>()` picks the new methods up automatically.

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/stripe/stripe.adapter.spec.ts && npm run typecheck && npm run lint`
Expected: PASS, including the existing `when stripe fails` cases (behaviour of `call` unchanged).

- [ ] **Step 7: Stage (commit after `/crit` go-ahead)**

```bash
git add src/stripe/stripe-gateway.ts src/stripe/stripe.adapter.ts src/stripe/stripe.adapter.spec.ts
# after go-ahead:
git commit -m "feat(stripe): add manual-capture hold authorization to the gateway"
```

### Task 2: `cancelHold` with already-canceled tolerance

**Files:**
- Modify: `src/stripe/stripe.adapter.ts`
- Test: `src/stripe/stripe.adapter.spec.ts`

**Interfaces:**
- Consumes: Task 1 port.
- Produces: `cancelHold(paymentIntentId)` resolves when the intent is canceled now or was already canceled; throws `StripeUnavailableError` when the intent is in any other non-cancelable state (e.g. captured); other failures map through `toDomainError`.

- [ ] **Step 1: Write the failing tests**

```ts
  describe('when canceling a hold', () => {
    const intentId = stripePaymentIntentId('pi_1');

    describe('when stripe cancels it', () => {
      beforeEach(() => {
        mocks.paymentIntentsCancel.mockResolvedValue({ id: 'pi_1', status: 'canceled' });
      });

      it('resolves', async () => {
        await expect(adapter.cancelHold(intentId)).resolves.toBeUndefined();
        expect(mocks.paymentIntentsCancel).toHaveBeenCalledWith('pi_1');
      });
    });

    describe('when the intent is already canceled', () => {
      beforeEach(() => {
        mocks.paymentIntentsCancel.mockRejectedValue(
          stripeFailureWith('StripeInvalidRequestError', { code: 'payment_intent_unexpected_state' }),
        );
        mocks.paymentIntentsRetrieve.mockResolvedValue({ id: 'pi_1', status: 'canceled' });
      });

      it('resolves', async () => {
        await expect(adapter.cancelHold(intentId)).resolves.toBeUndefined();
      });
    });

    describe('when the intent was captured', () => {
      beforeEach(() => {
        mocks.paymentIntentsCancel.mockRejectedValue(
          stripeFailureWith('StripeInvalidRequestError', { code: 'payment_intent_unexpected_state' }),
        );
        mocks.paymentIntentsRetrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded' });
      });

      it('throws stripe_unavailable', async () => {
        await expect(adapter.cancelHold(intentId)).rejects.toBeInstanceOf(StripeUnavailableError);
      });

      it('logs the status', async () => {
        await adapter.cancelHold(intentId).catch(() => undefined);

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('succeeded'));
      });
    });

    describe('when stripe is down', () => {
      beforeEach(() => {
        mocks.paymentIntentsCancel.mockRejectedValue(stripeFailure('StripeConnectionError'));
      });

      it('throws stripe_unavailable without retrieving', async () => {
        await expect(adapter.cancelHold(intentId)).rejects.toBeInstanceOf(StripeUnavailableError);
        expect(mocks.paymentIntentsRetrieve).not.toHaveBeenCalled();
      });
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/stripe/stripe.adapter.spec.ts -t "canceling a hold"`
Expected: FAIL on "already canceled" (temporary body throws `StripeRejectedError`).

- [ ] **Step 3: Implement**

Replace the temporary `cancelHold`:

```ts
  async cancelHold(paymentIntentId: StripePaymentIntentId): Promise<void> {
    const failure = await this.client.paymentIntents.cancel(paymentIntentId).then(
      () => null,
      (error: unknown) => error,
    );

    if (failure === null) {
      return;
    }

    if (this.errorField(failure, 'code') !== 'payment_intent_unexpected_state') {
      throw this.toDomainError('cancelHold', failure);
    }

    const intent = await this.call('retrievePaymentIntent', () =>
      this.client.paymentIntents.retrieve(paymentIntentId),
    );

    if (intent.status !== 'canceled') {
      this.logger.error(`Stripe hold ${paymentIntentId} cannot be canceled from status ${intent.status}`);

      throw new StripeUnavailableError();
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/stripe/stripe.adapter.spec.ts && npm run lint && npm run lint:arch && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Stage (commit after `/crit`)**

```bash
git add src/stripe/stripe.adapter.ts src/stripe/stripe.adapter.spec.ts
git commit -m "feat(stripe): cancel holds idempotently"
```

---

## PR B: escrow release

### Task 3: Escrow hold columns and idempotent `VOIDED` write

**Files:**
- Modify: `prisma/schema.prisma` (model `EscrowTransaction`)
- Create: `prisma/migrations/<timestamp>_add_escrow_hold_fields/migration.sql`
- Modify: `src/escrow/escrow-transaction.db.ts`
- Test: `src/escrow/escrow-transaction.db.spec.ts` (create), `src/escrow/escrow-transaction.db.int.spec.ts` (create)

**Interfaces:**
- Produces (`src/escrow/escrow-transaction.db.ts`):

```ts
export type HoldRelease = { bidId: BidId; paymentIntentId: StripePaymentIntentId; amountCents: Cents };
recordVoided(release: HoldRelease): Promise<void>;
```

- DB: `escrow_transactions.capture_before TIMESTAMPTZ(3) NULL`; unique `(stripe_payment_intent_id, type)`.

- [ ] **Step 1: Schema change**

In `model EscrowTransaction` add after `amountCents`:

```prisma
  captureBefore         DateTime?             @map("capture_before") @db.Timestamptz(3)
```

and add `@@unique([stripePaymentIntentId, type])` above `@@index([bidId, type])`.

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --create-only --name add_escrow_hold_fields` (see README "Hand-written SQL and `prisma migrate dev`" before accepting any drop of hand-written objects; the generated file must contain only):

```sql
-- AlterTable
ALTER TABLE "escrow_transactions" ADD COLUMN     "capture_before" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "escrow_transactions_stripe_payment_intent_id_type_key" ON "escrow_transactions"("stripe_payment_intent_id", "type");
```

If Prisma also proposes dropping hand-written CHECKs, partial indexes or triggers, delete those lines. Then `npx prisma migrate dev` to apply and `npx prisma generate`.

- [ ] **Step 3: Write the failing unit test**

`src/escrow/escrow-transaction.db.spec.ts`:

```ts
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { BidId } from '../common/ids';
import { cents } from '../common/money';
import { stripePaymentIntentId } from '../common/stripe-ids';
import type { PrismaService } from '../prisma/prisma.service';
import { EscrowTransactionDb } from './escrow-transaction.db';

describe('EscrowTransactionDb', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let db: EscrowTransactionDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new EscrowTransactionDb(prisma);
  });

  describe('recordVoided', () => {
    it('inserts a VOIDED row and skips duplicates', async () => {
      await db.recordVoided({
        bidId: 'bid-1' as BidId,
        paymentIntentId: stripePaymentIntentId('pi_1'),
        amountCents: cents(5_000),
      });

      expect(prisma.escrowTransaction.createMany).toHaveBeenCalledWith({
        data: [{ bidId: 'bid-1', stripePaymentIntentId: 'pi_1', type: 'VOIDED', amountCents: 5_000 }],
        skipDuplicates: true,
      });
    });
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/escrow/escrow-transaction.db.spec.ts`
Expected: FAIL, `db.recordVoided is not a function`.

- [ ] **Step 5: Implement**

In `src/escrow/escrow-transaction.db.ts` add imports (`Cents` from `../common/money`, `StripePaymentIntentId` from `../common/stripe-ids`), the `HoldRelease` type, and:

```ts
  async recordVoided(release: HoldRelease): Promise<void> {
    await this.prisma.escrowTransaction.createMany({
      data: [
        {
          bidId: release.bidId,
          stripePaymentIntentId: release.paymentIntentId,
          type: 'VOIDED',
          amountCents: release.amountCents,
        },
      ],
      skipDuplicates: true,
    });
  }
```

- [ ] **Step 6: Write the integration test**

`src/escrow/escrow-transaction.db.int.spec.ts` (pattern of `src/bids/usecases/place-bid/place-bid.usecase.int.spec.ts`: throwaway DB, `requireReachableInCi`, `describe.skipIf(!reachable)`):

```ts
import type { BidId } from '../common/ids';
import { cents } from '../common/money';
import { stripePaymentIntentId } from '../common/stripe-ids';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createAthlete,
  createAuction,
  createBidder,
  createRaceEntry,
} from '../testing/fixture-utilities';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../testing/throwaway-database';
import { EscrowTransactionDb } from './escrow-transaction.db';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);

describe.skipIf(!reachable)('EscrowTransactionDb (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let db: EscrowTransactionDb;
  let bidId: BidId;

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
    db = new EscrowTransactionDb(prisma);
    const athlete = await createAthlete(prisma);
    const entry = await createRaceEntry(prisma, { athleteId: athlete.id });
    const auction = await createAuction(prisma, { raceEntryId: entry.id });
    const bidder = await createBidder(prisma);
    const bid = await prisma.bid.create({
      data: { auctionId: auction.id, bidderId: bidder.id, amountCents: 5_000, status: 'OUTBID' },
    });
    bidId = bid.id as BidId;
  });

  afterAll(async () => {
    await database?.drop();
  });

  describe('when the same hold is voided twice', () => {
    it('keeps one VOIDED row', async () => {
      const release = { bidId, paymentIntentId: stripePaymentIntentId('pi_twice'), amountCents: cents(5_000) };

      await db.recordVoided(release);
      await db.recordVoided(release);

      expect(await prisma.escrowTransaction.count({ where: { stripePaymentIntentId: 'pi_twice' } })).toBe(1);
    });
  });

  describe('when a hold is authorized then voided', () => {
    it('keeps both rows', async () => {
      await prisma.escrowTransaction.create({
        data: { bidId, stripePaymentIntentId: 'pi_both', type: 'AUTHORIZED', amountCents: 5_000 },
      });
      await db.recordVoided({ bidId, paymentIntentId: stripePaymentIntentId('pi_both'), amountCents: cents(5_000) });

      expect(await prisma.escrowTransaction.count({ where: { stripePaymentIntentId: 'pi_both' } })).toBe(2);
    });
  });

  describe('when a second AUTHORIZED row is inserted for one intent', () => {
    it('is rejected by the unique index', async () => {
      await prisma.escrowTransaction.create({
        data: { bidId, stripePaymentIntentId: 'pi_dup', type: 'AUTHORIZED', amountCents: 5_000 },
      });

      await expect(
        prisma.escrowTransaction.create({
          data: { bidId, stripePaymentIntentId: 'pi_dup', type: 'AUTHORIZED', amountCents: 5_000 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/escrow && npm run test:integration -- src/escrow && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Stage (commit after `/crit`)**

```bash
git add prisma/schema.prisma prisma/migrations src/escrow
git commit -m "feat(escrow): add hold capture deadline and idempotent void record"
```

### Task 4: `EscrowTransactionService.releaseHold`

**Files:**
- Modify: `src/escrow/escrow-transaction.service.ts`, `src/escrow/escrow.module.ts`
- Test: `src/escrow/escrow-transaction.service.spec.ts`

**Interfaces:**
- Consumes: `StripeGateway.cancelHold` (Task 2), `EscrowTransactionDb.recordVoided` / `HoldRelease` (Task 3).
- Produces: `EscrowTransactionService.releaseHold(release: HoldRelease): Promise<void>` - cancels at Stripe then records `VOIDED`; propagates Stripe errors without recording. `EscrowModule` imports `StripeModule` and keeps exporting `EscrowTransactionService`.

- [ ] **Step 1: Write the failing tests**

In `escrow-transaction.service.spec.ts` add `let stripe: DeepMockProxy<StripeGateway>;`, provide `{ provide: StripeGateway, useValue: stripe }` in the testing module (create with `mockDeep<StripeGateway>()` in `beforeEach`), then:

```ts
  describe('releaseHold', () => {
    const release = {
      bidId: 'bid-1' as BidId,
      paymentIntentId: stripePaymentIntentId('pi_1'),
      amountCents: cents(5_000),
    };

    describe('when stripe cancels the hold', () => {
      beforeEach(() => {
        stripe.cancelHold.mockResolvedValue(undefined);
      });

      it('records a VOIDED row after the cancel', async () => {
        await service.releaseHold(release);

        expect(stripe.cancelHold).toHaveBeenCalledWith('pi_1');
        expect(db.recordVoided).toHaveBeenCalledWith(release);
        expect(stripe.cancelHold.mock.invocationCallOrder[0]).toBeLessThan(
          db.recordVoided.mock.invocationCallOrder[0],
        );
      });
    });

    describe('when stripe fails', () => {
      beforeEach(() => {
        stripe.cancelHold.mockRejectedValue(new StripeUnavailableError());
      });

      it('propagates the error', async () => {
        await expect(service.releaseHold(release)).rejects.toBeInstanceOf(StripeUnavailableError);
      });

      it('records nothing', async () => {
        await service.releaseHold(release).catch(() => undefined);

        expect(db.recordVoided).not.toHaveBeenCalled();
      });
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/escrow/escrow-transaction.service.spec.ts`
Expected: FAIL, `service.releaseHold is not a function`.

- [ ] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import type { BidId } from '../common/ids';
import { StripeGateway } from '../stripe/stripe-gateway';
import { EscrowTransactionDb, type HoldRelease } from './escrow-transaction.db';

@Injectable()
export class EscrowTransactionService {
  constructor(
    private readonly db: EscrowTransactionDb,
    private readonly stripe: StripeGateway,
  ) {}

  async hasActiveAuthorization(bidId: BidId): Promise<boolean> {
    const latest = await this.db.findLatestForBid(bidId);

    return latest?.type === 'AUTHORIZED';
  }

  async releaseHold(release: HoldRelease): Promise<void> {
    await this.stripe.cancelHold(release.paymentIntentId);
    await this.db.recordVoided(release);
  }
}
```

`escrow.module.ts`: add `imports: [StripeModule]` (`import { StripeModule } from '../stripe/stripe.module';`).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/escrow && npm run lint && npm run lint:arch && npm run typecheck`
Expected: PASS. Also boot check: `npm test` (any app-level module spec must still compile the graph).

- [ ] **Step 5: Stage (commit after `/crit`)**

```bash
git add src/escrow
git commit -m "feat(escrow): release outbid holds through the gateway"
```

---

## PR C1: token + card gate

### Task 5: Usecase db reads the bidder; bidder upsert removed

**Files:**
- Modify: `src/bids/usecases/place-bid/place-bid.usecase.db.ts`
- Test: `src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts`

**Interfaces:**
- Produces:

```ts
export type BiddingBidder = {
  id: BidderId;
  email: NormalizedEmail;
  tokenVersion: number;
  stripeCustomerId: StripeCustomerId | null;
  defaultPaymentMethodId: StripePaymentMethodId | null;
};
PlaceBidUsecaseDb.findBidder(id: BidderId): Promise<BiddingBidder | null>;
// PlaceBidSession loses upsertBidder; keeps findLeading, markOutbid, insertLeading.
```

- [ ] **Step 1: Write the failing tests**

In `place-bid.usecase.db.spec.ts` delete `describe('upsertBidder', ...)` and add at top level:

```ts
  describe('findBidder', () => {
    describe('when the bidder exists with a card', () => {
      beforeEach(() => {
        prisma.bidder.findUnique.mockResolvedValue({
          id: 'bidder-1',
          email: 'brand@example.com',
          tokenVersion: 2,
          stripeCustomerId: 'cus_1',
          defaultPaymentMethodId: 'pm_1',
        } as never);
      });

      it('returns the branded bidder', async () => {
        await expect(db.findBidder('bidder-1' as BidderId)).resolves.toEqual({
          id: 'bidder-1',
          email: 'brand@example.com',
          tokenVersion: 2,
          stripeCustomerId: 'cus_1',
          defaultPaymentMethodId: 'pm_1',
        });
        expect(prisma.bidder.findUnique).toHaveBeenCalledWith({
          where: { id: 'bidder-1' },
          select: { id: true, email: true, tokenVersion: true, stripeCustomerId: true, defaultPaymentMethodId: true },
        });
      });
    });

    describe('when the bidder has no card', () => {
      beforeEach(() => {
        prisma.bidder.findUnique.mockResolvedValue({
          id: 'bidder-1',
          email: 'brand@example.com',
          tokenVersion: 0,
          stripeCustomerId: null,
          defaultPaymentMethodId: null,
        } as never);
      });

      it('returns null card fields', async () => {
        await expect(db.findBidder('bidder-1' as BidderId)).resolves.toMatchObject({
          stripeCustomerId: null,
          defaultPaymentMethodId: null,
        });
      });
    });

    describe('when the bidder does not exist', () => {
      beforeEach(() => {
        prisma.bidder.findUnique.mockResolvedValue(null);
      });

      it('returns null', async () => {
        await expect(db.findBidder('bidder-1' as BidderId)).resolves.toBeNull();
      });
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts`
Expected: FAIL, `db.findBidder is not a function`.

- [ ] **Step 3: Implement**

In `place-bid.usecase.db.ts`: import `stripeCustomerId`, `stripePaymentMethodId`, and their types from `../../../common/stripe-ids`; add `BiddingBidder`; remove `upsertBidder` from `PlaceBidSession` and `sessionFor`; add:

```ts
  async findBidder(id: BidderId): Promise<BiddingBidder | null> {
    const bidder = await this.prisma.bidder.findUnique({
      where: { id },
      select: { id: true, email: true, tokenVersion: true, stripeCustomerId: true, defaultPaymentMethodId: true },
    });

    if (!bidder) {
      return null;
    }

    return {
      id,
      email: normalizeEmail(bidder.email),
      tokenVersion: bidder.tokenVersion,
      stripeCustomerId: bidder.stripeCustomerId == null ? null : stripeCustomerId(bidder.stripeCustomerId),
      defaultPaymentMethodId:
        bidder.defaultPaymentMethodId == null ? null : stripePaymentMethodId(bidder.defaultPaymentMethodId),
    };
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts`
Expected: PASS. (`place-bid.usecase.ts` no longer compiles until Task 6; do not stage separately.)

### Task 6: Usecase enforces token, version and card

**Files:**
- Modify: `src/bids/usecases/place-bid/place-bid.usecase.ts`, `src/bids/usecases/place-bid/place-bid.module.ts`
- Test: `src/bids/usecases/place-bid/place-bid.usecase.spec.ts`

**Interfaces:**
- Consumes: `BidderTokenService.verify(raw: string | undefined): Promise<{ bidderId: BidderId; tokenVersion: number }>` (throws `UnauthorizedException('bidder_token_required')`), `PlaceBidUsecaseDb.findBidder` (Task 5).
- Produces:

```ts
export type PlaceBidInput = { auctionId: AuctionId; bidderToken: string | undefined; amountCents: Cents };
export type CardedBidder = {
  id: BidderId;
  email: NormalizedEmail;
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
};
// constructor(db: PlaceBidUsecaseDb, tokens: BidderTokenService)
// errors: 401 UnauthorizedException('bidder_token_required'), 403 ForbiddenError('card_required')
```

- [ ] **Step 1: Rewrite the spec setup and add failing tests**

In `place-bid.usecase.spec.ts`:
- `input()` becomes `{ auctionId, bidderToken: 'token-1', amountCents: cents(1000), ...overrides }`.
- Add `let tokens: DeepMockProxy<BidderTokenService>;` (`mockDeep`), `tokens.verify.mockResolvedValue({ bidderId: 'bidder-2' as BidderId, tokenVersion: 1 })`, and `db.findBidder.mockResolvedValue({ id: 'bidder-2' as BidderId, email: 'brand@example.com' as NormalizedEmail, tokenVersion: 1, stripeCustomerId: stripeCustomerId('cus_2'), defaultPaymentMethodId: stripePaymentMethodId('pm_2') })` in the top `beforeEach`; `usecase = new PlaceBidUsecase(db, tokens)`.
- Remove `session.upsertBidder` setup.
- The self-bid case now sets `db.findBidder` email to `auction.athleteEmail` in its own `beforeEach` and drops the `upsertBidder` assertion.

New cases:

```ts
  describe('when the bidder token is rejected', () => {
    beforeEach(() => {
      tokens.verify.mockRejectedValue(new UnauthorizedException('bidder_token_required'));
    });

    it('rejects without opening a transaction', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new UnauthorizedException('bidder_token_required'));
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the token bidder no longer exists', () => {
    beforeEach(() => {
      db.findBidder.mockResolvedValue(null);
    });

    it('rejects as token required', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new UnauthorizedException('bidder_token_required'));
    });
  });

  describe('when the token version is stale', () => {
    beforeEach(() => {
      tokens.verify.mockResolvedValue({ bidderId: 'bidder-2' as BidderId, tokenVersion: 0 });
    });

    it('rejects as token required', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new UnauthorizedException('bidder_token_required'));
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder has no saved card', () => {
    beforeEach(() => {
      db.findBidder.mockResolvedValue({
        id: 'bidder-2' as BidderId,
        email: 'brand@example.com' as NormalizedEmail,
        tokenVersion: 1,
        stripeCustomerId: stripeCustomerId('cus_2'),
        defaultPaymentMethodId: null,
      });
    });

    it('rejects as card required', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ForbiddenError('card_required'));
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder has no stripe customer', () => {
    beforeEach(() => {
      db.findBidder.mockResolvedValue({
        id: 'bidder-2' as BidderId,
        email: 'brand@example.com' as NormalizedEmail,
        tokenVersion: 1,
        stripeCustomerId: null,
        defaultPaymentMethodId: stripePaymentMethodId('pm_2'),
      });
    });

    it('rejects as card required', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ForbiddenError('card_required'));
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.spec.ts`
Expected: FAIL (constructor arity, missing gate).

- [ ] **Step 3: Implement**

In `place-bid.usecase.ts`:

```ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { BidderTokenService } from '../../../bidders/bidder-token.service';
// ...existing imports; add StripeCustomerId, StripePaymentMethodId types

export type PlaceBidInput = { auctionId: AuctionId; bidderToken: string | undefined; amountCents: Cents };

export type CardedBidder = {
  id: BidderId;
  email: NormalizedEmail;
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
};

  constructor(
    private readonly db: PlaceBidUsecaseDb,
    private readonly tokens: BidderTokenService,
  ) {}

  async execute(input: PlaceBidInput): Promise<PlaceBidResult> {
    if (input.amountCents > MAX_BID_CENTS) {
      this.logger.warn(`Bid of ${input.amountCents} cents on auction ${input.auctionId} exceeds the maximum`);

      throw new InvalidValueError('bid_above_maximum');
    }

    const bidder = await this.cardedBidder(input.bidderToken);
    const result = await this.db.withLockedAuction(input.auctionId, (auction, session) =>
      this.place(input, bidder, auction, session),
    );

    if (!result) {
      this.logger.warn(`Auction ${input.auctionId} not found`);

      throw new NotFoundError('auction_not_found');
    }

    return result;
  }

  private async cardedBidder(rawToken: string | undefined): Promise<CardedBidder> {
    const verified = await this.tokens.verify(rawToken);
    const bidder = await this.db.findBidder(verified.bidderId);

    if (bidder === null) {
      this.logger.warn(`Bidder token presented for unknown bidder ${verified.bidderId}`);

      throw new UnauthorizedException('bidder_token_required');
    }

    if (bidder.tokenVersion !== verified.tokenVersion) {
      this.logger.warn(
        `Bidder token version ${verified.tokenVersion} is stale for bidder ${bidder.id} (current ${bidder.tokenVersion})`,
      );

      throw new UnauthorizedException('bidder_token_required');
    }

    if (bidder.stripeCustomerId === null || bidder.defaultPaymentMethodId === null) {
      this.logger.warn(`Bidder ${bidder.id} has no saved card`);

      throw new ForbiddenError('card_required');
    }

    return {
      id: bidder.id,
      email: bidder.email,
      customerId: bidder.stripeCustomerId,
      paymentMethodId: bidder.defaultPaymentMethodId,
    };
  }
```

`place(input, bidder, auction, session)`: compare `bidder.email === auction.athleteEmail` for self-bid, drop `session.upsertBidder`, use `bidder.id` where `bidderId` was used. Everything else unchanged.

`place-bid.module.ts`: `imports: [BidderTokenModule]` (`import { BidderTokenModule } from '../../../bidders/bidder-token.module';`).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/bids/usecases/place-bid && npm run typecheck`
Expected: unit specs PASS; typecheck fails only in `bid.controller.ts` and specs fixed in Task 7.

### Task 7: Endpoint reads `X-Bidder-Token`, drops `email`; int spec and README

**Files:**
- Modify: `src/bids/bid.controller.ts`, `src/bids/dto/place-bid.dto.ts`
- Test: `src/bids/bid.controller.spec.ts`, `src/bids/bid-throttle.spec.ts`, `src/bids/usecases/place-bid/place-bid.usecase.int.spec.ts`
- Modify: `README.md` (section "Bidding (HYR-40)")

**Interfaces:**
- Consumes: `PlaceBidInput` (Task 6).
- Produces: `POST /auctions/:auctionId/bids`, header `X-Bidder-Token`, body `{ amountCents }`.

- [ ] **Step 1: Update the HTTP specs (failing)**

`bid.controller.spec.ts`:
- `postBid(body, auctionPath = 'auc-1', token: string | undefined = 'token-1')` sends `...(token === undefined ? {} : { 'X-Bidder-Token': token })` in headers.
- Every body drops `email`.
- Replace the old email-forwarding assertion with:

```ts
    it('forwards the token header and amount', async () => {
      await postBid({ amountCents: 5_500 });

      expect(placeBid).toHaveBeenCalledWith({ auctionId: 'auc-1', bidderToken: 'token-1', amountCents: 5_500 });
    });

  describe('when the body carries an email', () => {
    it('rejects it as an unknown field', async () => {
      const reply = await postBid({ email: 'jamie@x.com', amountCents: 5_500 });

      expect(reply.status).toBe(400);
      expect(placeBid).not.toHaveBeenCalled();
    });
  });

  describe('when the header is missing', () => {
    it('passes undefined to the service', async () => {
      await postBid({ amountCents: 5_500 }, 'auc-1', undefined);

      expect(placeBid).toHaveBeenCalledWith(expect.objectContaining({ bidderToken: undefined }));
    });
  });

  describe('when the service reports a missing card', () => {
    beforeEach(() => {
      placeBid.mockRejectedValue(new ForbiddenError('card_required'));
    });

    it('returns 403 card_required', async () => {
      const reply = await postBid({ amountCents: 5_500 });

      expect(reply).toMatchObject({ status: 403, json: { message: 'card_required' } });
    });
  });

  describe('when the service rejects the token', () => {
    beforeEach(() => {
      placeBid.mockRejectedValue(new UnauthorizedException('bidder_token_required'));
    });

    it('returns 401 bidder_token_required', async () => {
      const reply = await postBid({ amountCents: 5_500 });

      expect(reply).toMatchObject({ status: 401, json: { message: 'bidder_token_required' } });
    });
  });
```

Remove existing cases that validate `email` (invalid / too long email) - the field no longer exists.

`bid-throttle.spec.ts`: body becomes `JSON.stringify({ amountCents: 5_500 })`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/bids/bid.controller.spec.ts src/bids/bid-throttle.spec.ts`
Expected: FAIL (email still accepted, header not forwarded).

- [ ] **Step 3: Implement**

`place-bid.dto.ts`:

```ts
import { IsInt, Min } from 'class-validator';

export class PlaceBidDto {
  @IsInt()
  @Min(1)
  amountCents!: number;
}
```

`bid.controller.ts`:

```ts
import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
// drop normalizeEmail import

  async placeBid(
    @Param() params: AuctionBidParamsDto,
    @Body() body: PlaceBidDto,
    @Headers('x-bidder-token') bidderToken: string | undefined,
  ): Promise<PlaceBidResponse> {
    const result = await this.service.placeBid({
      auctionId: params.auctionId,
      bidderToken,
      amountCents: cents(body.amountCents),
    });

    return toPlaceBidResponse(result);
  }
```

- [ ] **Step 4: Rewrite the integration spec for carded bidders**

In `place-bid.usecase.int.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BidderTokenService } from '../../../bidders/bidder-token.service';
import { bidderId } from '../../../common/ids';
import { createBidder } from '../../../testing/fixture-utilities';

const SECRET = 'place-bid-int-secret-at-least-32-characters';

  let tokens: BidderTokenService;
  // beforeAll:
  tokens = new BidderTokenService(new JwtService({ secret: SECRET }), { ttlSeconds: 900 });
  usecase = new PlaceBidUsecase(new PlaceBidUsecaseDb(prisma), tokens);

  async function cardedBidderToken(localPart: string): Promise<string> {
    const bidder = await createBidder(prisma, {
      email: `${localPart}@example.com`,
      stripeCustomerId: `cus_${localPart}`,
      defaultPaymentMethodId: `pm_${localPart}`,
      cardBrand: 'visa',
      cardLast4: '4242',
    });
    const issued = await tokens.issue(bidderId(bidder.id), bidder.tokenVersion);

    return issued.token;
  }

  async function bidAs(auctionId: AuctionId, localPart: string, amount: number): Promise<PlaceBidInput> {
    return { auctionId, bidderToken: await cardedBidderToken(localPart), amountCents: cents(amount) };
  }
```

(`createBidder` INSERTs, so the HYR-60 trigger does not fire and `tokenVersion` stays 0.)

Rewrite each scenario to build all inputs first, then race them:

```ts
      const inputs = await Promise.all([0, 1, 2, 3, 4, 5].map((index) => bidAs(auctionId, `same-${index}`, 1500)));
      const results = await Promise.allSettled(inputs.map((bidInput) => usecase.execute(bidInput)));
```

Same pattern for "ascending distinct amounts", "lock held" and "races the close job" (create the bidder before each iteration's race). "Same bidder fires twice" uses one `bidAs(...)` result passed twice; drop the bidder-count assertion.

Replace `describe('when a rejected bid would have created a new bidder', ...)` with:

```ts
  describe('when the bidder email is the athlete email', () => {
    it('rejects the self-bid', async () => {
      const { auctionId, athleteEmail } = await seedAuction();
      const localPart = athleteEmail.split('@')[0];
      const bidder = await createBidder(prisma, {
        email: athleteEmail,
        stripeCustomerId: `cus_self_${localPart}`,
        defaultPaymentMethodId: 'pm_self',
        cardBrand: 'visa',
        cardLast4: '4242',
      });
      const issued = await tokens.issue(bidderId(bidder.id), 0);

      await expect(
        usecase.execute({ auctionId, bidderToken: issued.token, amountCents: cents(1500) }),
      ).rejects.toMatchObject({ code: 'self_bid_not_allowed' });
    });
  });

  describe('when the bidder has no card', () => {
    it('rejects as card required and writes no bid', async () => {
      const { auctionId } = await seedAuction();
      const bidder = await createBidder(prisma, { email: 'no-card@example.com' });
      const issued = await tokens.issue(bidderId(bidder.id), 0);

      await expect(
        usecase.execute({ auctionId, bidderToken: issued.token, amountCents: cents(1500) }),
      ).rejects.toMatchObject({ code: 'card_required' });
      expect(await bidsOf(auctionId)).toHaveLength(0);
    });
  });

  describe('when the card was saved after the token was issued', () => {
    it('rejects the stale token', async () => {
      const { auctionId } = await seedAuction();
      const bidder = await createBidder(prisma, { email: 'late-card@example.com', stripeCustomerId: 'cus_late' });
      const issued = await tokens.issue(bidderId(bidder.id), 0);

      await prisma.$executeRaw`
        UPDATE "bidders" SET "default_payment_method_id" = 'pm_late', "card_brand" = 'visa', "card_last4" = '4242'
        WHERE "id" = ${bidder.id}`;

      await expect(
        usecase.execute({ auctionId, bidderToken: issued.token, amountCents: cents(1500) }),
      ).rejects.toThrow(new UnauthorizedException('bidder_token_required'));
    });
  });
```

The last case documents spec D2 (owner lockout) with a real trigger bump.

Note: `athleteEmail` fixture emails must satisfy `bidders_email_normalized_check`; `createAthlete` already produces lowercase emails.

- [ ] **Step 5: README**

In "Bidding (HYR-40)" (rename to "Bidding (HYR-40, HYR-11)"): body becomes `{ "amountCents": integer >= 1 }`; header `X-Bidder-Token` required (token from `POST /bidders/setup-intents`); bidder must have a saved card; error table adds `401 bidder_token_required` and `403 card_required`; note that `email` is now rejected as an unknown field; remove "anyone can bid as anyone"; keep "no public exposure" and point it at the token-reissue prerequisite (spec D2).

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run lint:arch && npm run typecheck && npm test && npm run test:integration -- src/bids`
Expected: PASS.

- [ ] **Step 7: Stage PR C1 (commit after `/crit`)**

```bash
git add src/bids README.md
git commit -m "feat(bids): require bidder token and saved card to bid"
```

---

## PR C2: holds in place-bid

### Task 8: Pure bid rules shared by preflight and the locked path

**Files:**
- Create: `src/bids/usecases/place-bid/bid-rules.ts`
- Test: `src/bids/usecases/place-bid/bid-rules.spec.ts`
- Modify: `src/bids/usecases/place-bid/place-bid.usecase.ts`

**Interfaces:**
- Consumes: `LockedAuction`, `LeadingBid` types (`place-bid.usecase.db.ts`), `minimumNextBidCents` (`src/bids/bid-increment.ts`).
- Produces:

```ts
export type BidRuleInput = {
  auction: LockedAuction;
  leading: Pick<LeadingBid, 'bidderId' | 'amountCents'> | null;
  bidder: { id: BidderId; email: NormalizedEmail };
  amountCents: Cents;
};
export type BidRuleViolation = { error: DomainError; detail: string };
export function findBidRuleViolation(input: BidRuleInput): BidRuleViolation | null;
```

- [ ] **Step 1: Write the failing spec**

```ts
import { ConflictError, ForbiddenError, InvalidValueError } from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { BidderId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { findBidRuleViolation, type BidRuleInput } from './bid-rules';

describe('findBidRuleViolation', () => {
  let input: BidRuleInput;

  beforeEach(() => {
    input = {
      auction: {
        status: 'OPEN',
        dbNow: new Date('2026-11-08T12:00:00Z'),
        closeAt: new Date('2026-11-09T06:00:00Z'),
        floorPriceCents: cents(1000),
        athleteEmail: 'athlete@example.com' as NormalizedEmail,
        athleteBanned: false,
      },
      leading: null,
      bidder: { id: 'bidder-2' as BidderId, email: 'brand@example.com' as NormalizedEmail },
      amountCents: cents(1000),
    };
  });

  describe('when every rule passes', () => {
    it('returns null', () => {
      expect(findBidRuleViolation(input)).toBeNull();
    });
  });

  describe('when the auction is not OPEN', () => {
    beforeEach(() => {
      input.auction.status = 'SCHEDULED';
    });

    it('returns auction_not_open', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('auction_not_open'));
    });
  });

  describe('when closeAt is not after the database time', () => {
    beforeEach(() => {
      input.auction.closeAt = input.auction.dbNow;
    });

    it('returns auction_not_open', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('auction_not_open'));
    });
  });

  describe('when the seller is banned', () => {
    beforeEach(() => {
      input.auction.athleteBanned = true;
    });

    it('returns auction_not_open', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('auction_not_open'));
    });
  });

  describe('when the bidder is the athlete', () => {
    beforeEach(() => {
      input.bidder.email = input.auction.athleteEmail;
    });

    it('returns self_bid_not_allowed', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ForbiddenError('self_bid_not_allowed'));
    });
  });

  describe('when the bidder already leads', () => {
    beforeEach(() => {
      input.leading = { bidderId: input.bidder.id, amountCents: cents(5000) };
      input.amountCents = cents(9000);
    });

    it('returns already_leading', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('already_leading'));
    });
  });

  describe('when the amount is below the minimum', () => {
    beforeEach(() => {
      input.leading = { bidderId: 'bidder-1' as BidderId, amountCents: cents(5000) };
      input.amountCents = cents(5499);
    });

    it('returns bid_below_minimum with the minimum in the detail', () => {
      const violation = findBidRuleViolation(input);

      expect(violation?.error).toEqual(new InvalidValueError('bid_below_minimum'));
      expect(violation?.detail).toContain('5500');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/bids/usecases/place-bid/bid-rules.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { ConflictError, ForbiddenError, InvalidValueError, type DomainError } from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { BidderId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { minimumNextBidCents } from '../../bid-increment';
import type { LeadingBid, LockedAuction } from './place-bid.usecase.db';

export type BidRuleInput = {
  auction: LockedAuction;
  leading: Pick<LeadingBid, 'bidderId' | 'amountCents'> | null;
  bidder: { id: BidderId; email: NormalizedEmail };
  amountCents: Cents;
};

export type BidRuleViolation = { error: DomainError; detail: string };

export function findBidRuleViolation(input: BidRuleInput): BidRuleViolation | null {
  const { auction, leading, bidder, amountCents } = input;

  if (auction.status !== 'OPEN') {
    return { error: new ConflictError('auction_not_open'), detail: `auction is ${auction.status}` };
  }

  if (auction.closeAt <= auction.dbNow) {
    return { error: new ConflictError('auction_not_open'), detail: `closed at ${auction.closeAt.toISOString()}` };
  }

  if (auction.athleteBanned) {
    return { error: new ConflictError('auction_not_open'), detail: 'seller is banned' };
  }

  if (bidder.email === auction.athleteEmail) {
    return { error: new ForbiddenError('self_bid_not_allowed'), detail: 'self-bid' };
  }

  if (leading && leading.bidderId === bidder.id) {
    return { error: new ConflictError('already_leading'), detail: `bidder ${bidder.id} already leads` };
  }

  const minimum = minimumNextBidCents(leading ? leading.amountCents : null, auction.floorPriceCents);

  if (amountCents < minimum) {
    return {
      error: new InvalidValueError('bid_below_minimum'),
      detail: `bid of ${amountCents} cents is below the minimum of ${minimum}`,
    };
  }

  return null;
}
```

In `place-bid.usecase.ts` replace `assertOpen` and the inline checks in `place` with:

```ts
  private assertBiddable(auctionId: AuctionId, input: BidRuleInput): void {
    const violation = findBidRuleViolation(input);

    if (violation) {
      this.logger.warn(`Bid on auction ${auctionId} refused: ${violation.detail}`);

      throw violation.error;
    }
  }
```

and in `place`: `const leading = await session.findLeading();` then `this.assertBiddable(input.auctionId, { auction, leading, bidder, amountCents: input.amountCents });`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/bids/usecases/place-bid`
Expected: PASS (existing usecase cases still hold; the self-bid case no longer asserts "before touching bidders").

- [ ] **Step 5: Stage (commit after `/crit`)**

```bash
git add src/bids/usecases/place-bid
git commit -m "refactor(bids): extract pure bid rules"
```

### Task 9: Usecase db: unlocked snapshot, leader's hold, `AUTHORIZED` write

**Files:**
- Modify: `src/bids/usecases/place-bid/place-bid.usecase.db.ts`
- Test: `src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts`

**Interfaces:**
- Produces:

```ts
export type ActiveHold = { paymentIntentId: StripePaymentIntentId; amountCents: Cents };
export type AuthorizedHold = ActiveHold & { captureBefore: Date | null };
export type LeadingBid = { id: BidId; bidderId: BidderId; amountCents: Cents; hold: ActiveHold | null };
export type BiddingSnapshot = { auction: LockedAuction; leading: LeadingBid | null };

PlaceBidUsecaseDb.readBiddingSnapshot(auctionId: AuctionId): Promise<BiddingSnapshot | null>;
PlaceBidSession.recordAuthorized(bidId: BidId, hold: AuthorizedHold): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

Update `describe('findLeading')` expectations and add:

```ts
    describe('findLeading', () => {
      describe('when the leader has an active hold', () => {
        beforeEach(() => {
          tx.bid.findFirst.mockResolvedValue({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            escrowTransactions: [{ type: 'AUTHORIZED', stripePaymentIntentId: 'pi_1', amountCents: 5000 }],
          } as never);
        });

        it('returns the hold', async () => {
          await expect(session.findLeading()).resolves.toEqual({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            hold: { paymentIntentId: 'pi_1', amountCents: 5000 },
          });
          expect(tx.bid.findFirst).toHaveBeenCalledWith({
            where: { auctionId, status: 'LEADING' },
            include: { escrowTransactions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
          });
        });
      });

      describe('when the leader has no hold', () => {
        beforeEach(() => {
          tx.bid.findFirst.mockResolvedValue({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            escrowTransactions: [],
          } as never);
        });

        it('returns a null hold', async () => {
          await expect(session.findLeading()).resolves.toMatchObject({ hold: null });
        });
      });

      describe('when the leader hold was already voided', () => {
        beforeEach(() => {
          tx.bid.findFirst.mockResolvedValue({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            escrowTransactions: [{ type: 'VOIDED', stripePaymentIntentId: 'pi_1', amountCents: 5000 }],
          } as never);
        });

        it('returns a null hold', async () => {
          await expect(session.findLeading()).resolves.toMatchObject({ hold: null });
        });
      });
    });

    describe('recordAuthorized', () => {
      it('inserts an AUTHORIZED row with the capture deadline', async () => {
        const captureBefore = new Date('2026-11-15T12:00:00Z');

        await session.recordAuthorized('bid-2' as BidId, {
          paymentIntentId: stripePaymentIntentId('pi_2'),
          amountCents: cents(5500),
          captureBefore,
        });

        expect(tx.escrowTransaction.create).toHaveBeenCalledWith({
          data: { bidId: 'bid-2', stripePaymentIntentId: 'pi_2', type: 'AUTHORIZED', amountCents: 5500, captureBefore },
        });
      });
    });
```

and at top level:

```ts
  describe('readBiddingSnapshot', () => {
    describe('when the auction exists', () => {
      beforeEach(() => {
        prisma.$queryRaw.mockResolvedValue([{ db_now: dbNow }] as never);
        prisma.auction.findUnique.mockResolvedValue({
          status: 'OPEN',
          closeAt,
          floorPriceCents: 1000,
          raceEntry: { athlete: { email: 'athlete@example.com', isBanned: false } },
          bids: [{ id: 'bid-1', bidderId: 'bidder-1', amountCents: 5000 }],
        } as never);
      });

      it('returns the unlocked snapshot with the leader', async () => {
        await expect(db.readBiddingSnapshot(auctionId)).resolves.toEqual({
          auction: {
            status: 'OPEN',
            closeAt,
            dbNow,
            floorPriceCents: 1000,
            athleteEmail: 'athlete@example.com',
            athleteBanned: false,
          },
          leading: { id: 'bid-1', bidderId: 'bidder-1', amountCents: 5000, hold: null },
        });
      });

      it('does not lock or open a transaction', async () => {
        await db.readBiddingSnapshot(auctionId);

        const [strings] = prisma.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];

        expect(strings.join('?')).not.toContain('FOR UPDATE');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe('when the auction does not exist', () => {
      beforeEach(() => {
        prisma.$queryRaw.mockResolvedValue([{ db_now: dbNow }] as never);
        prisma.auction.findUnique.mockResolvedValue(null);
      });

      it('returns null', async () => {
        await expect(db.readBiddingSnapshot(auctionId)).resolves.toBeNull();
      });
    });
  });
```

(`hold` is null in the snapshot by design: preflight never needs the leader's hold.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `place-bid.usecase.db.ts`:

```ts
const AUCTION_SELECT = {
  status: true,
  closeAt: true,
  floorPriceCents: true,
  raceEntry: { select: { athlete: { select: { email: true, isBanned: true } } } },
} as const;

type AuctionRow = Prisma.AuctionGetPayload<{ select: typeof AUCTION_SELECT }>;

  async readBiddingSnapshot(auctionId: AuctionId): Promise<BiddingSnapshot | null> {
    const [{ db_now: dbNow }] = await this.prisma.$queryRaw<Array<{ db_now: Date }>>`SELECT now() AS "db_now"`;
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: {
        ...AUCTION_SELECT,
        bids: { where: { status: 'LEADING' }, select: { id: true, bidderId: true, amountCents: true }, take: 1 },
      },
    });

    if (!auction) {
      return null;
    }

    const [leading] = auction.bids;

    return {
      auction: this.toLockedAuction(auction, dbNow),
      leading: leading
        ? { id: leading.id as BidId, bidderId: leading.bidderId as BidderId, amountCents: cents(leading.amountCents), hold: null }
        : null,
    };
  }

  private toLockedAuction(auction: AuctionRow, dbNow: Date): LockedAuction {
    return {
      status: auction.status,
      closeAt: auction.closeAt,
      dbNow,
      floorPriceCents: cents(auction.floorPriceCents),
      athleteEmail: normalizeEmail(auction.raceEntry.athlete.email),
      athleteBanned: auction.raceEntry.athlete.isBanned,
    };
  }
```

Use `AUCTION_SELECT` and `toLockedAuction` in `withLockedAuction` too (behaviour unchanged). `Prisma` becomes a value import only if `Prisma.AuctionGetPayload` needs it; it is a type, so `import type { Prisma }` stays.

Session changes:

```ts
      findLeading: async (): Promise<LeadingBid | null> => {
        const leading = await tx.bid.findFirst({
          where: { auctionId, status: 'LEADING' },
          include: { escrowTransactions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
        });

        if (!leading) {
          return null;
        }

        const [latest] = leading.escrowTransactions;

        return {
          id: leading.id as BidId,
          bidderId: leading.bidderId as BidderId,
          amountCents: cents(leading.amountCents),
          hold:
            latest?.type === 'AUTHORIZED'
              ? { paymentIntentId: stripePaymentIntentId(latest.stripePaymentIntentId), amountCents: cents(latest.amountCents) }
              : null,
        };
      },
      recordAuthorized: async (bidId, hold): Promise<void> => {
        await tx.escrowTransaction.create({
          data: {
            bidId,
            stripePaymentIntentId: hold.paymentIntentId,
            type: 'AUTHORIZED',
            amountCents: hold.amountCents,
            captureBefore: hold.captureBefore,
          },
        });
      },
```

Add `recordAuthorized(bidId: BidId, hold: AuthorizedHold): Promise<void>;` to `PlaceBidSession`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.db.spec.ts`
Expected: PASS.

### Task 10: `PaymentRequiredError` mapped to 402

**Files:**
- Modify: `src/common/domain-error.ts`, `src/common/domain-error.filter.ts`
- Test: `src/common/domain-error.filter.spec.ts`

**Interfaces:**
- Produces: `export class PaymentRequiredError extends DomainError {}`; filter maps it to `402` with label `'Payment Required'`.

- [ ] **Step 1: Write the failing test**

```ts
  describe('when a PaymentRequiredError is caught', () => {
    it('responds 402 with the code', () => {
      filter.catch(new PaymentRequiredError('card_declined'), host);

      expect(status).toHaveBeenCalledWith(402);
      expect(json).toHaveBeenCalledWith({ statusCode: 402, message: 'card_declined', error: 'Payment Required' });
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/common/domain-error.filter.spec.ts`
Expected: FAIL (import missing).

- [ ] **Step 3: Implement**

`domain-error.ts`: add `export class PaymentRequiredError extends DomainError {}`.
`domain-error.filter.ts`: import it, add `[PaymentRequiredError, HttpStatus.PAYMENT_REQUIRED]` to `STATUS_BY_ERROR` and `[HttpStatus.PAYMENT_REQUIRED]: 'Payment Required'` to `ERROR_LABEL_BY_STATUS`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/common/domain-error.filter.spec.ts`
Expected: PASS.

### Task 11: Usecase authorizes, compensates and releases

**Files:**
- Modify: `src/bids/usecases/place-bid/place-bid.usecase.ts`, `src/bids/usecases/place-bid/place-bid.module.ts`
- Test: `src/bids/usecases/place-bid/place-bid.usecase.spec.ts`; adjust fixtures in `src/bids/place-bid-response.spec.ts`, `src/bids/bid.controller.spec.ts` (`previousLeader` gains `hold: null`)

**Interfaces:**
- Consumes: `StripeGateway.authorizeHold` / `cancelHold` (Tasks 1-2), `EscrowTransactionService.releaseHold` (Task 4), `findBidRuleViolation` (Task 8), db additions (Task 9), `PaymentRequiredError` (Task 10).
- Produces:

```ts
export type PreviousLeader = { bidId: BidId; bidderId: BidderId; amountCents: Cents; hold: ActiveHold | null };
// constructor(db, tokens: BidderTokenService, stripe: StripeGateway, escrow: EscrowTransactionService)
// new errors: 402 PaymentRequiredError('card_declined'), 403 ForbiddenError('card_required') on unusable pm
```

- [ ] **Step 1: Write the failing tests**

Top-level setup additions in `place-bid.usecase.spec.ts`:

```ts
  let stripe: DeepMockProxy<StripeGateway>;
  let escrow: DeepMockProxy<EscrowTransactionService>;
  const hold = { paymentIntentId: stripePaymentIntentId('pi_new'), captureBefore: new Date('2026-11-15T12:00:00Z') };

  // in beforeEach:
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  stripe = mockDeep<StripeGateway>();
  escrow = mockDeep<EscrowTransactionService>();
  stripe.authorizeHold.mockResolvedValue({ outcome: 'authorized', ...hold });
  db.readBiddingSnapshot.mockImplementation(async () => ({ auction, leading: null }));
  usecase = new PlaceBidUsecase(db, tokens, stripe, escrow);
```

`leader(bidderId, amount)` helper also sets `db.readBiddingSnapshot` to return the same leader (with `hold: null`) and `session.findLeading` to return it with `hold: { paymentIntentId: stripePaymentIntentId('pi_old'), amountCents: cents(amount) }`.

New cases:

```ts
  describe('when the preflight rejects the bid', () => {
    beforeEach(() => {
      auction.status = 'CLOSED';
    });

    it('never calls stripe', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ConflictError('auction_not_open'));
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the preflight finds no auction', () => {
    beforeEach(() => {
      db.readBiddingSnapshot.mockResolvedValue(null);
    });

    it('rejects as not found without calling stripe', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new NotFoundError('auction_not_found'));
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
    });
  });

  describe('when the card is declined', () => {
    beforeEach(() => {
      stripe.authorizeHold.mockResolvedValue({ outcome: 'declined', reason: 'insufficient_funds' });
    });

    it('rejects as card declined without a transaction', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new PaymentRequiredError('card_declined'));
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when stripe cannot use the payment method', () => {
    beforeEach(() => {
      stripe.authorizeHold.mockResolvedValue({ outcome: 'payment_method_unusable', reason: 'resource_missing' });
    });

    it('rejects as card required', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ForbiddenError('card_required'));
    });
  });

  describe('when the hold is authorized and the bid commits', () => {
    it('authorizes the bid amount on the saved card', async () => {
      await usecase.execute(input({ amountCents: cents(1500) }));

      expect(stripe.authorizeHold).toHaveBeenCalledWith({
        customerId: 'cus_2',
        paymentMethodId: 'pm_2',
        amountCents: 1500,
        auctionId,
        bidderId: 'bidder-2',
        attemptId: expect.any(String),
      });
    });

    it('records the hold on the new bid inside the transaction', async () => {
      await usecase.execute(input({ amountCents: cents(1500) }));

      expect(session.recordAuthorized).toHaveBeenCalledWith('bid-2', { ...hold, amountCents: 1500 });
      expect(session.insertLeading.mock.invocationCallOrder[0]).toBeLessThan(
        session.recordAuthorized.mock.invocationCallOrder[0],
      );
    });

    it('uses a fresh attempt id per call', async () => {
      await usecase.execute(input());
      await usecase.execute(input());

      const [first, second] = stripe.authorizeHold.mock.calls.map(([call]) => call.attemptId);

      expect(first).not.toBe(second);
    });

    it('does not cancel the new hold', async () => {
      await usecase.execute(input());

      expect(stripe.cancelHold).not.toHaveBeenCalled();
    });
  });

  describe('when the locked place rejects after the hold', () => {
    beforeEach(() => {
      db.withLockedAuction.mockRejectedValue(new InvalidValueError('bid_below_minimum'));
    });

    it('cancels the new hold and rethrows', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new InvalidValueError('bid_below_minimum'));
      expect(stripe.cancelHold).toHaveBeenCalledWith('pi_new');
    });

    describe('and the cancel also fails', () => {
      beforeEach(() => {
        stripe.cancelHold.mockRejectedValue(new StripeUnavailableError());
      });

      it('still rethrows the original error', async () => {
        await expect(usecase.execute(input())).rejects.toThrow(new InvalidValueError('bid_below_minimum'));
      });
    });
  });

  describe('when the auction disappears under the lock', () => {
    beforeEach(() => {
      db.withLockedAuction.mockResolvedValue(null as never);
    });

    it('cancels the new hold', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new NotFoundError('auction_not_found'));
      expect(stripe.cancelHold).toHaveBeenCalledWith('pi_new');
    });
  });

  describe('when the bid outbids a held leader', () => {
    beforeEach(() => {
      leader('bidder-1', 5000);
    });

    it('releases the previous hold after the transaction', async () => {
      await usecase.execute(input({ amountCents: cents(5500) }));

      expect(escrow.releaseHold).toHaveBeenCalledWith({
        bidId: 'bid-1',
        paymentIntentId: 'pi_old',
        amountCents: 5000,
      });
      expect(db.withLockedAuction.mock.invocationCallOrder[0]).toBeLessThan(
        escrow.releaseHold.mock.invocationCallOrder[0],
      );
    });

    describe('and the release fails', () => {
      beforeEach(() => {
        escrow.releaseHold.mockRejectedValue(new StripeUnavailableError());
      });

      it('still returns the placed bid', async () => {
        await expect(usecase.execute(input({ amountCents: cents(5500) }))).resolves.toMatchObject({
          bid: { id: 'bid-2' },
        });
      });
    });
  });

  describe('when the previous leader has no hold', () => {
    beforeEach(() => {
      leader('bidder-1', 5000);
      session.findLeading.mockResolvedValue({
        id: 'bid-1' as BidId,
        bidderId: 'bidder-1' as BidderId,
        amountCents: cents(5000),
        hold: null,
      });
    });

    it('releases nothing', async () => {
      await usecase.execute(input({ amountCents: cents(5500) }));

      expect(escrow.releaseHold).not.toHaveBeenCalled();
    });
  });
```

Update the existing "reports the previous leader" expectation to include `hold: { paymentIntentId: 'pi_old', amountCents: 5000 }`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/bids/usecases/place-bid/place-bid.usecase.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`place-bid.usecase.ts` (full shape; keep `cardedBidder` from Task 6 and `assertBiddable` from Task 8):

```ts
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { BidderTokenService } from '../../../bidders/bidder-token.service';
import {
  ForbiddenError,
  InvalidValueError,
  NotFoundError,
  PaymentRequiredError,
} from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import type { StripeCustomerId, StripePaymentIntentId, StripePaymentMethodId } from '../../../common/stripe-ids';
import { EscrowTransactionService } from '../../../escrow/escrow-transaction.service';
import { StripeGateway } from '../../../stripe/stripe-gateway';
import { MAX_BID_CENTS } from '../../bid-increment';
import { findBidRuleViolation, type BidRuleInput } from './bid-rules';
import {
  PlaceBidUsecaseDb,
  type ActiveHold,
  type AuthorizedHold,
  type LockedAuction,
  type PlaceBidSession,
  type PlacedBid,
} from './place-bid.usecase.db';

export type PreviousLeader = { bidId: BidId; bidderId: BidderId; amountCents: Cents; hold: ActiveHold | null };

  constructor(
    private readonly db: PlaceBidUsecaseDb,
    private readonly tokens: BidderTokenService,
    private readonly stripe: StripeGateway,
    private readonly escrow: EscrowTransactionService,
  ) {}

  async execute(input: PlaceBidInput): Promise<PlaceBidResult> {
    if (input.amountCents > MAX_BID_CENTS) {
      this.logger.warn(`Bid of ${input.amountCents} cents on auction ${input.auctionId} exceeds the maximum`);

      throw new InvalidValueError('bid_above_maximum');
    }

    const bidder = await this.cardedBidder(input.bidderToken);

    await this.preflight(input, bidder);

    const hold = await this.authorize(input, bidder);
    const result = await this.placeHeld(input, bidder, hold);

    await this.releasePrevious(result.previousLeader);

    return result;
  }

  private async preflight(input: PlaceBidInput, bidder: CardedBidder): Promise<void> {
    const snapshot = await this.db.readBiddingSnapshot(input.auctionId);

    if (snapshot === null) {
      this.logger.warn(`Auction ${input.auctionId} not found`);

      throw new NotFoundError('auction_not_found');
    }

    this.assertBiddable(input.auctionId, {
      auction: snapshot.auction,
      leading: snapshot.leading,
      bidder,
      amountCents: input.amountCents,
    });
  }

  private async authorize(input: PlaceBidInput, bidder: CardedBidder): Promise<AuthorizedHold> {
    const attemptId = randomUUID();
    const authorization = await this.stripe.authorizeHold({
      customerId: bidder.customerId,
      paymentMethodId: bidder.paymentMethodId,
      amountCents: input.amountCents,
      auctionId: input.auctionId,
      bidderId: bidder.id,
      attemptId,
    });

    if (authorization.outcome === 'declined') {
      this.logger.warn(`Hold for bidder ${bidder.id} on auction ${input.auctionId} declined (${authorization.reason})`);

      throw new PaymentRequiredError('card_declined');
    }

    if (authorization.outcome === 'payment_method_unusable') {
      this.logger.warn(`Saved card of bidder ${bidder.id} is unusable (${authorization.reason})`);

      throw new ForbiddenError('card_required');
    }

    this.logger.log(`Hold ${authorization.paymentIntentId} authorized for attempt ${attemptId}`);

    return {
      paymentIntentId: authorization.paymentIntentId,
      amountCents: input.amountCents,
      captureBefore: authorization.captureBefore,
    };
  }

  private async placeHeld(input: PlaceBidInput, bidder: CardedBidder, hold: AuthorizedHold): Promise<PlaceBidResult> {
    try {
      const result = await this.db.withLockedAuction(input.auctionId, (auction, session) =>
        this.place(input, bidder, hold, auction, session),
      );

      if (!result) {
        this.logger.warn(`Auction ${input.auctionId} not found`);

        throw new NotFoundError('auction_not_found');
      }

      return result;
    } catch (error) {
      await this.cancelUnplacedHold(hold.paymentIntentId);

      throw error;
    }
  }

  private async cancelUnplacedHold(paymentIntentId: StripePaymentIntentId): Promise<void> {
    try {
      await this.stripe.cancelHold(paymentIntentId);
    } catch (error) {
      this.logger.error(
        `Hold ${paymentIntentId} for a rejected bid was not canceled: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async releasePrevious(previousLeader: PreviousLeader | null): Promise<void> {
    if (previousLeader === null || previousLeader.hold === null) {
      return;
    }

    const { hold } = previousLeader;

    try {
      await this.escrow.releaseHold({
        bidId: previousLeader.bidId,
        paymentIntentId: hold.paymentIntentId,
        amountCents: hold.amountCents,
      });
    } catch (error) {
      this.logger.error(
        `Hold ${hold.paymentIntentId} of outbid bid ${previousLeader.bidId} was not released: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async place(
    input: PlaceBidInput,
    bidder: CardedBidder,
    hold: AuthorizedHold,
    auction: LockedAuction,
    session: PlaceBidSession,
  ): Promise<PlaceBidResult> {
    const leading = await session.findLeading();

    this.assertBiddable(input.auctionId, { auction, leading, bidder, amountCents: input.amountCents });

    if (leading) {
      // The partial unique index allows one LEADING bid per auction, so demote before inserting.
      await session.markOutbid(leading.id);
    }

    const bid = await session.insertLeading(bidder.id, input.amountCents);

    await session.recordAuthorized(bid.id, hold);

    return {
      bid,
      closeAt: auction.closeAt,
      previousLeader: leading
        ? { bidId: leading.id, bidderId: leading.bidderId, amountCents: leading.amountCents, hold: leading.hold }
        : null,
    };
  }
```

Remove now-unused imports (`ConflictError`, `minimumNextBidCents`) if lint flags them.

`place-bid.module.ts`:

```ts
@Module({
  imports: [BidderTokenModule, StripeModule, EscrowModule],
  providers: [PlaceBidUsecase, PlaceBidUsecaseDb],
  exports: [PlaceBidUsecase],
})
```

Fixture updates: `place-bid-response.spec.ts` line ~41 and `bid.controller.spec.ts` line ~26 add `hold: null` to `previousLeader`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run lint && npm run lint:arch && npm run typecheck && npm test`
Expected: PASS.

### Task 12: Integration coverage for holds, README

**Files:**
- Test: `src/bids/usecases/place-bid/place-bid.usecase.int.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above; real `PlaceBidUsecaseDb`, `EscrowTransactionDb`, `EscrowTransactionService`, `BidderTokenService`; fake `StripeGateway`.

- [ ] **Step 1: Add the fake gateway and wire the usecase**

```ts
import { EscrowTransactionDb } from '../../../escrow/escrow-transaction.db';
import { EscrowTransactionService } from '../../../escrow/escrow-transaction.service';
import { stripePaymentIntentId } from '../../../common/stripe-ids';
import type { AuthorizeHoldInput, HoldAuthorization, StripeGateway } from '../../../stripe/stripe-gateway';

  let authorized: string[];
  let canceled: string[];
  let decline: boolean;

  // beforeAll, after prisma:
  const gateway = {
    authorizeHold: async (holdInput: AuthorizeHoldInput): Promise<HoldAuthorization> => {
      if (decline) {
        return { outcome: 'declined', reason: 'insufficient_funds' };
      }

      const id = `pi_${holdInput.attemptId.replaceAll('-', '')}`;

      authorized.push(id);

      return { outcome: 'authorized', paymentIntentId: stripePaymentIntentId(id), captureBefore: null };
    },
    cancelHold: async (paymentIntentId: string): Promise<void> => {
      canceled.push(paymentIntentId);
    },
  } as unknown as StripeGateway;
  usecase = new PlaceBidUsecase(
    new PlaceBidUsecaseDb(prisma),
    tokens,
    gateway,
    new EscrowTransactionService(new EscrowTransactionDb(prisma), gateway),
  );

  beforeEach(() => {
    authorized = [];
    canceled = [];
    decline = false;
  });

  function escrowOf(auctionId: AuctionId): Promise<Array<{ bidId: string; type: string; stripePaymentIntentId: string }>> {
    return prisma.escrowTransaction.findMany({ where: { bid: { auctionId } }, orderBy: { createdAt: 'asc' } });
  }
```

- [ ] **Step 2: Add the hold scenarios**

```ts
  describe('when six bidders race the same valid amount (holds)', () => {
    it('keeps exactly one hold and cancels every loser', async () => {
      const { auctionId } = await seedAuction();
      const inputs = await Promise.all([0, 1, 2, 3, 4, 5].map((index) => bidAs(auctionId, `hold-same-${index}`, 1500)));

      await Promise.allSettled(inputs.map((bidInput) => usecase.execute(bidInput)));

      const rows = await escrowOf(auctionId);
      const leading = (await bidsOf(auctionId)).filter((bid) => bid.status === 'LEADING');

      expect(rows.filter((row) => row.type === 'AUTHORIZED')).toHaveLength(1);
      expect(rows[0].bidId).toBe(leading[0].id);
      expect([...canceled].sort()).toEqual(authorized.filter((id) => id !== rows[0].stripePaymentIntentId).sort());
    });
  });

  describe('when a held leader is outbid', () => {
    it('voids the previous hold exactly once', async () => {
      const { auctionId } = await seedAuction();
      const first = await usecase.execute(await bidAs(auctionId, 'hold-first', 1500));

      await usecase.execute(await bidAs(auctionId, 'hold-second', 2000));

      const rows = await escrowOf(auctionId);
      const firstRows = rows.filter((row) => row.bidId === first.bid.id);

      expect(firstRows.map((row) => row.type)).toEqual(['AUTHORIZED', 'VOIDED']);
      expect(canceled).toEqual([firstRows[0].stripePaymentIntentId]);
    });
  });

  describe('when the card is declined', () => {
    it('writes no bid and no escrow row', async () => {
      const { auctionId } = await seedAuction();
      const bidInput = await bidAs(auctionId, 'hold-declined', 1500);

      decline = true;

      await expect(usecase.execute(bidInput)).rejects.toMatchObject({ code: 'card_declined' });
      expect(await bidsOf(auctionId)).toHaveLength(0);
      expect(await escrowOf(auctionId)).toHaveLength(0);
    });
  });
```

In the existing "races the close job" loop add: when the bid was rejected, `expect(canceled).toContain(...)` for the authorized id of that attempt (or `authorized.length === canceled.length` after the iteration when rejected; reset both arrays at the top of each iteration), and when it succeeded, exactly one `AUTHORIZED` row for the `WON` bid.

- [ ] **Step 3: Run**

Run: `npm run test:integration -- src/bids src/escrow`
Expected: PASS.

- [ ] **Step 4: README**

In "Bidding (HYR-40, HYR-11)": each accepted bid holds the bid amount on the saved card (manual-capture PaymentIntent, off-session); the previous leader's hold is canceled after the new bid commits; error table adds `402 card_declined` and `502 stripe_unavailable` / `stripe_misconfigured`; note that failed releases / compensating cancels are logged at `error` (grep `was not released`, `was not canceled`) and Stripe drops them at `capture_before` until the reconciliation sweep ticket lands; holds are captured at close by HYR-12. Link the spec.

- [ ] **Step 5: Full verification and stage PR C2 (commit after `/crit`)**

Run: `npm run verify:fast && npm run test:integration`
Expected: PASS.

```bash
git add src/bids src/common README.md
git commit -m "feat(bids): hold the bid amount on the saved card and release on outbid"
```

---

## Self-review notes

- Spec coverage: D3/D4 (Tasks 8, 9, 11), D5 (Task 7), D6/D7 (Task 6, 11), D8/D10 (Task 1), D9 (Task 11 attempt id test), D11 (Task 11 compensate cases), D13/D14 (Task 9, 11), D15/D17 (Task 4, 11), D16 (Task 2, 3), D18 (Task 3), D20 (Task 11 "no hold" case), README (Tasks 7, 12). D1 option (c)'s close-time capture lives in HYR-12 (spec 4.5 contract). D2, sweep, webhook, re-auth, web form are follow-up tickets (spec section 9).
- Out of this plan by design: anything for HYR-12 / HYR-14; deleting `hasActiveAuthorization` (spec follow-up 7).
