# HYR-58 Stripe Customer, Setup Intent and Payment Method Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `StripeGateway` port and `StripeAdapter` with `createCustomer`, `createSetupIntent`, `retrievePaymentMethod` and the `StripeSetupIntentId` / `StripePaymentMethodId` brands.

**Architecture:** New abstract methods on the existing port; implementations in the single SDK adapter via the existing `call()` error-mapping wrapper; ids branded only inside the adapter through validating constructors in `src/common/stripe-ids.ts`.

**Tech Stack:** NestJS, TypeScript, stripe 23.1.0 (already pinned, no new deps), Vitest.

**Spec:** `docs/specs/2026-11-14-hyr-58-stripe-customer-setup-intent-design.md`

## Global Constraints

- Backend-only. No endpoints, no DB/migration changes, no webhook, no web.
- No new dependencies (exact pins already in place).
- Explicit return types on every function; `readonly` constructor params; no single-letter variables; no inline `if` (brace, body on own line); blank line before `if`/`for`/`return`/`throw` unless first in block; numeric separators on 5+ digit literals; no barrel files; no comments unless a non-obvious why.
- Error codes are snake_case; human detail goes to `this.logger`; helpers in `src/common` throw only the code and never log.
- Tests: Vitest, nested `describe('when ...')`, short `it` titles stating outcome only.
- Commits: conventional commits, lowercase imperative, end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage and stop for `/crit` before the final commit of implementation work (per user rule); intermediate local commits only if the executor needs them.
- Verify after each task: `npx vitest run src/stripe src/common/stripe-ids.spec.ts` and `npm run typecheck`. Final: `npm run verify`.

## Ticket split

Fits one PR: about 340 lines of code and tests (docs excluded). One layer (backend), no actor. No split.

## File Structure

- Modify `src/common/stripe-ids.ts`: two brands + constructors.
- Modify `src/common/stripe-ids.spec.ts`: two rows in `cases`.
- Modify `src/stripe/stripe-gateway.ts`: three types, three abstract methods.
- Modify `src/stripe/stripe.adapter.ts`: three methods + one private brand helper.
- Modify `src/stripe/stripe.adapter.spec.ts`: new SDK mocks, describes, error-mapping rows.

---

### Task 1: Setup intent and payment method id brands

**Files:**
- Modify: `src/common/stripe-ids.ts`
- Test: `src/common/stripe-ids.spec.ts`

**Interfaces:**
- Produces: `StripeSetupIntentId`, `stripeSetupIntentId(value: string): StripeSetupIntentId` (prefix `seti_`, code `stripe_setup_intent_id_invalid`); `StripePaymentMethodId`, `stripePaymentMethodId(value: string): StripePaymentMethodId` (prefix `pm_`, code `stripe_payment_method_id_invalid`).

- [ ] **Step 1: Write the failing test.** In `stripe-ids.spec.ts` change the import to `import { stripeConnectAccountId, stripeCustomerId, stripePaymentIntentId, stripePaymentMethodId, stripeSetupIntentId } from './stripe-ids';` and append to `cases`:

```ts
  {
    name: 'stripeSetupIntentId',
    build: stripeSetupIntentId,
    prefix: 'seti_',
    code: 'stripe_setup_intent_id_invalid',
  },
  {
    name: 'stripePaymentMethodId',
    build: stripePaymentMethodId,
    prefix: 'pm_',
    code: 'stripe_payment_method_id_invalid',
  },
```

- [ ] **Step 2: Run** `npx vitest run src/common/stripe-ids.spec.ts`. Expected: FAIL (constructors not exported).

- [ ] **Step 3: Implement.** In `stripe-ids.ts` add after the existing brand types:

```ts
export type StripeSetupIntentId = Brand<string, 'StripeSetupIntentId'>;
export type StripePaymentMethodId = Brand<string, 'StripePaymentMethodId'>;
```

and at the end:

```ts
export function stripeSetupIntentId(value: string): StripeSetupIntentId {
  return prefixedStripeId(value, 'seti_', 'stripe_setup_intent_id_invalid');
}

export function stripePaymentMethodId(value: string): StripePaymentMethodId {
  return prefixedStripeId(value, 'pm_', 'stripe_payment_method_id_invalid');
}
```

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat(stripe): add setup intent and payment method id brands`

---

### Task 2: createCustomer

**Files:**
- Modify: `src/stripe/stripe-gateway.ts`, `src/stripe/stripe.adapter.ts`
- Test: `src/stripe/stripe.adapter.spec.ts`

**Interfaces:**
- Consumes: `StripeCustomerId`/`stripeCustomerId` (existing), `BidderId`/`bidderId` from `src/common/ids`.
- Produces: `CreateCustomerInput = { bidderId: BidderId; email: NormalizedEmail }`; `abstract createCustomer(input: CreateCustomerInput): Promise<StripeCustomerId>`; adapter private `brandReturnedId<T>(label: string, raw: string, build: (value: string) => T): T` (used by Tasks 3 and 4).

- [ ] **Step 1: Write the failing tests.** In the spec: add `customersCreate: vi.fn()` to `mocks`, `customers = { create: mocks.customersCreate };` to `FakeStripe`, extend imports (`bidderId` from `../common/ids`, `stripeCustomerId` from `../common/stripe-ids`), add `const BIDDER = bidderId('bidder-1');`, then after the `creating an onboarding link` describe:

```ts
  describe('when creating a customer', () => {
    beforeEach(() => {
      mocks.customersCreate.mockResolvedValue({ id: 'cus_123' });
    });

    it('sends the email and bidder metadata with the idempotency key', async () => {
      await adapter.createCustomer({ bidderId: BIDDER, email: EMAIL });

      expect(mocks.customersCreate).toHaveBeenCalledWith(
        { email: 'ath@example.com', metadata: { bidderId: 'bidder-1' } },
        { idempotencyKey: 'bidder-customer:bidder-1' },
      );
    });

    it('returns the branded customer id', async () => {
      const id = await adapter.createCustomer({ bidderId: BIDDER, email: EMAIL });

      expect(id).toBe(stripeCustomerId('cus_123'));
    });

    describe('when stripe returns a malformed customer id', () => {
      beforeEach(() => {
        mocks.customersCreate.mockResolvedValue({ id: 'xyz_1' });
      });

      it('maps to stripe_unavailable', async () => {
        await expect(adapter.createCustomer({ bidderId: BIDDER, email: EMAIL })).rejects.toBeInstanceOf(
          StripeUnavailableError,
        );
      });

      it('logs the detail', async () => {
        await adapter.createCustomer({ bidderId: BIDDER, email: EMAIL }).catch(() => undefined);

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('customer'));
      });
    });
  });
```

Also add to the `error mapping` `describe.each` table:

```ts
    [
      'createCustomer',
      mocks.customersCreate,
      (adapter: StripeAdapter): Promise<unknown> => adapter.createCustomer({ bidderId: BIDDER, email: EMAIL }),
    ],
```

- [ ] **Step 2: Run** `npx vitest run src/stripe/stripe.adapter.spec.ts`. Expected: FAIL (`createCustomer` is not a function).

- [ ] **Step 3: Implement.** Port (`stripe-gateway.ts`): import `BidderId` from `../common/ids` (merge with `AthleteId` import) and `StripeCustomerId`; add

```ts
export type CreateCustomerInput = {
  bidderId: BidderId;
  email: NormalizedEmail;
};
```

and in the class `abstract createCustomer(input: CreateCustomerInput): Promise<StripeCustomerId>;`.

Adapter (`stripe.adapter.ts`): import `stripeCustomerId, type StripeCustomerId`, `CreateCustomerInput`; add after `createOnboardingLink`:

```ts
  async createCustomer(input: CreateCustomerInput): Promise<StripeCustomerId> {
    const customer = await this.call('createCustomer', () =>
      this.client.customers.create(
        { email: input.email, metadata: { bidderId: input.bidderId } },
        { idempotencyKey: `bidder-customer:${input.bidderId}` },
      ),
    );

    return this.brandReturnedId('customer', customer.id, stripeCustomerId);
  }
```

and next to `brandAccountId`:

```ts
  private brandReturnedId<T>(label: string, raw: string, build: (value: string) => T): T {
    try {
      return build(raw);
    } catch (error) {
      this.logger.error(`Stripe returned a malformed ${label} id: ${this.describe(error)} (${raw})`);

      throw new StripeUnavailableError();
    }
  }
```

- [ ] **Step 4: Run** `npx vitest run src/stripe/stripe.adapter.spec.ts`, then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(stripe): add create customer to gateway port and adapter`

---

### Task 3: createSetupIntent

**Files:**
- Modify: `src/stripe/stripe-gateway.ts`, `src/stripe/stripe.adapter.ts`
- Test: `src/stripe/stripe.adapter.spec.ts`

**Interfaces:**
- Consumes: `brandReturnedId` (Task 2), `stripeSetupIntentId` (Task 1).
- Produces: `SetupIntentHandle = { id: StripeSetupIntentId; clientSecret: string }`; `abstract createSetupIntent(customerId: StripeCustomerId): Promise<SetupIntentHandle>`.

- [ ] **Step 1: Write the failing tests.** Add `setupIntentsCreate: vi.fn()` to mocks, `setupIntents = { create: mocks.setupIntentsCreate };` to FakeStripe, import `stripeSetupIntentId`, and:

```ts
  describe('when creating a setup intent', () => {
    const CUSTOMER = stripeCustomerId('cus_123');

    beforeEach(() => {
      mocks.setupIntentsCreate.mockResolvedValue({ id: 'seti_123', client_secret: 'seti_123_secret_abc' });
    });

    it('sends an off-session card-only request for the customer', async () => {
      await adapter.createSetupIntent(CUSTOMER);

      expect(mocks.setupIntentsCreate).toHaveBeenCalledWith({
        customer: 'cus_123',
        usage: 'off_session',
        allowed_payment_method_types: ['card'],
      });
    });

    it('returns the branded id and client secret', async () => {
      const handle = await adapter.createSetupIntent(CUSTOMER);

      expect(handle).toEqual({ id: stripeSetupIntentId('seti_123'), clientSecret: 'seti_123_secret_abc' });
    });

    describe('when stripe returns no client secret', () => {
      beforeEach(() => {
        mocks.setupIntentsCreate.mockResolvedValue({ id: 'seti_123', client_secret: null });
      });

      it('maps to stripe_unavailable', async () => {
        await expect(adapter.createSetupIntent(CUSTOMER)).rejects.toBeInstanceOf(StripeUnavailableError);
      });

      it('logs the setup intent id', async () => {
        await adapter.createSetupIntent(CUSTOMER).catch(() => undefined);

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('seti_123'));
      });
    });

    describe('when stripe returns a malformed setup intent id', () => {
      beforeEach(() => {
        mocks.setupIntentsCreate.mockResolvedValue({ id: 'xyz_1', client_secret: 'secret' });
      });

      it('maps to stripe_unavailable', async () => {
        await expect(adapter.createSetupIntent(CUSTOMER)).rejects.toBeInstanceOf(StripeUnavailableError);
      });
    });
  });
```

Add table row:

```ts
    [
      'createSetupIntent',
      mocks.setupIntentsCreate,
      (adapter: StripeAdapter): Promise<unknown> => adapter.createSetupIntent(stripeCustomerId('cus_123')),
    ],
```

- [ ] **Step 2: Run** `npx vitest run src/stripe/stripe.adapter.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Port: add `SetupIntentHandle` type, import `StripeSetupIntentId`, and `abstract createSetupIntent(customerId: StripeCustomerId): Promise<SetupIntentHandle>;`. Adapter (import `stripeSetupIntentId`, `SetupIntentHandle`):

```ts
  async createSetupIntent(customerId: StripeCustomerId): Promise<SetupIntentHandle> {
    const intent = await this.call('createSetupIntent', () =>
      this.client.setupIntents.create({
        customer: customerId,
        usage: 'off_session',
        allowed_payment_method_types: ['card'],
      }),
    );

    if (intent.client_secret == null) {
      this.logger.error(`Stripe setup intent ${intent.id} has no client secret`);

      throw new StripeUnavailableError();
    }

    return {
      id: this.brandReturnedId('setup intent', intent.id, stripeSetupIntentId),
      clientSecret: intent.client_secret,
    };
  }
```

- [ ] **Step 4: Run** spec + `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(stripe): add create setup intent to gateway port and adapter`

---

### Task 4: retrievePaymentMethod

**Files:**
- Modify: `src/stripe/stripe-gateway.ts`, `src/stripe/stripe.adapter.ts`
- Test: `src/stripe/stripe.adapter.spec.ts`

**Interfaces:**
- Consumes: `brandReturnedId`, `stripePaymentMethodId` (Task 1).
- Produces: `PaymentMethodSnapshot = { id: StripePaymentMethodId; brand: string; last4: string; expMonth: number; expYear: number }`; `abstract retrievePaymentMethod(paymentMethodId: StripePaymentMethodId): Promise<PaymentMethodSnapshot>`.

- [ ] **Step 1: Write the failing tests.** Add `paymentMethodsRetrieve: vi.fn()` to mocks, `paymentMethods = { retrieve: mocks.paymentMethodsRetrieve };` to FakeStripe, import `stripePaymentMethodId`, and:

```ts
  describe('when retrieving a payment method', () => {
    const PAYMENT_METHOD = stripePaymentMethodId('pm_123');

    beforeEach(() => {
      mocks.paymentMethodsRetrieve.mockResolvedValue({
        id: 'pm_123',
        type: 'card',
        card: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2030 },
      });
    });

    it('retrieves by id', async () => {
      await adapter.retrievePaymentMethod(PAYMENT_METHOD);

      expect(mocks.paymentMethodsRetrieve).toHaveBeenCalledWith('pm_123');
    });

    it('returns the card display data with a branded id', async () => {
      const snapshot = await adapter.retrievePaymentMethod(PAYMENT_METHOD);

      expect(snapshot).toEqual({
        id: stripePaymentMethodId('pm_123'),
        brand: 'visa',
        last4: '4242',
        expMonth: 8,
        expYear: 2030,
      });
    });

    describe('when the payment method is not a card', () => {
      beforeEach(() => {
        mocks.paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_123', type: 'us_bank_account' });
      });

      it('maps to stripe_unavailable', async () => {
        await expect(adapter.retrievePaymentMethod(PAYMENT_METHOD)).rejects.toBeInstanceOf(StripeUnavailableError);
      });

      it('logs the payment method id and type', async () => {
        await adapter.retrievePaymentMethod(PAYMENT_METHOD).catch(() => undefined);

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('pm_123'));
      });
    });

    describe('when stripe returns a malformed payment method id', () => {
      beforeEach(() => {
        mocks.paymentMethodsRetrieve.mockResolvedValue({
          id: 'xyz_1',
          type: 'card',
          card: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2030 },
        });
      });

      it('maps to stripe_unavailable', async () => {
        await expect(adapter.retrievePaymentMethod(PAYMENT_METHOD)).rejects.toBeInstanceOf(StripeUnavailableError);
      });
    });

    describe('when the payment method does not exist', () => {
      beforeEach(() => {
        mocks.paymentMethodsRetrieve.mockRejectedValue(stripeFailure('StripeInvalidRequestError'));
      });

      it('maps to stripe_request_rejected', async () => {
        await expect(adapter.retrievePaymentMethod(PAYMENT_METHOD)).rejects.toBeInstanceOf(StripeRejectedError);
      });
    });
  });
```

Add table row:

```ts
    [
      'retrievePaymentMethod',
      mocks.paymentMethodsRetrieve,
      (adapter: StripeAdapter): Promise<unknown> => adapter.retrievePaymentMethod(stripePaymentMethodId('pm_123')),
    ],
```

- [ ] **Step 2: Run** the spec. Expected: FAIL.

- [ ] **Step 3: Implement.** Port: add `PaymentMethodSnapshot` type, import `StripePaymentMethodId`, `abstract retrievePaymentMethod(paymentMethodId: StripePaymentMethodId): Promise<PaymentMethodSnapshot>;`. Adapter (import `stripePaymentMethodId, type StripePaymentMethodId`, `PaymentMethodSnapshot`):

```ts
  async retrievePaymentMethod(paymentMethodId: StripePaymentMethodId): Promise<PaymentMethodSnapshot> {
    const method = await this.call('retrievePaymentMethod', () => this.client.paymentMethods.retrieve(paymentMethodId));

    if (method.card == null) {
      this.logger.error(`Stripe payment method ${method.id} is not a card (${method.type})`);

      throw new StripeUnavailableError();
    }

    return {
      id: this.brandReturnedId('payment method', method.id, stripePaymentMethodId),
      brand: method.card.brand,
      last4: method.card.last4,
      expMonth: method.card.exp_month,
      expYear: method.card.exp_year,
    };
  }
```

- [ ] **Step 4: Run** spec, `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(stripe): add retrieve payment method to gateway port and adapter`

---

### Task 5: Full verification and staging

- [ ] **Step 1:** `npm run verify`. Expected: format, lint, lint:arch, typecheck, tests, build all green. Run `npx prettier --write` on touched files if `format:check` fails.
- [ ] **Step 2:** `git status`; confirm only the five files above plus the two docs changed, no new dependency, no migration.
- [ ] **Step 3:** Stage and stop; tell the user to run `/crit` before the final commit.

## Self-Review

- Spec 3.1 -> Task 1; 3.2/3.3 -> Tasks 2-4; 3.4 tests -> in each task. Names consistent: `brandReturnedId`, `SetupIntentHandle`, `PaymentMethodSnapshot`, `CreateCustomerInput`.
- Port gains one method per task so every commit typechecks (adapter `implements` the port).
- Existing fakes use `mockDeep` / `as unknown as StripeGateway`, so they compile unchanged.
