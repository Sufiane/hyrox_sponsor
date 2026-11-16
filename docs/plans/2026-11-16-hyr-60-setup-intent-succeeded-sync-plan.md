# HYR-60: Sync bidder payment method from `setup_intent.succeeded` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a platform `setup_intent.succeeded` webhook, save the bidder's card (payment method id, brand, last4) and bump `token_version` in one atomic first-write-wins UPDATE, idempotent on replay.

**Architecture:** A `StripeEventHandler` in `src/bidders` parses and brands the event payload and calls `BidderService.syncPaymentMethod`, a thin delegate to `SyncPaymentMethodUsecase`. The usecase resolves the bidder by Stripe customer id, short-circuits replays and second cards without a Stripe call, fetches brand/last4 through the existing `StripeGateway.retrievePaymentMethod`, and writes through its own `*.usecase.db.ts` (`updateMany ... WHERE default_payment_method_id IS NULL`). A separate small migration adds a `BEFORE UPDATE` trigger as a backstop for the token version invariant.

**Tech Stack:** NestJS, Prisma 6 (Postgres), Vitest, `vitest-mock-extended`, Stripe webhooks (existing HYR-1 pipeline).

**Spec:** `docs/specs/2026-11-16-hyr-60-setup-intent-succeeded-sync-design.md`

## Ticket split (read first)

Backend only, one actor (system / Stripe). Estimated about 960 lines in total, over the ~800 cap, so three PRs. A does not depend on B (B's explicit increment gives the same result with or without the trigger), either order is fine; B2 depends on B1. All branch from `hyr-59-c` (stack B1 on it, B2 on B1).

| PR | Tasks | Est. lines |
|---|---|---|
| A: token version trigger | Task 1 | ~110 |
| B1: sync usecase | Tasks 2-4 (usecase db, usecase, module, service delegate, usecase int spec) | ~555 |
| B2: webhook handler | Tasks 5-6 (handler, wiring, webhook-level int, runbook, README) | ~330 |

B1 has no live caller until B2 merges (its int spec exercises it); acceptable because a single B PR would be about 885 lines.

## Global Constraints

- Hexagonal split: `*.usecase.ts` has no ORM import; `*.usecase.db.ts` is the only Prisma importer in its folder. Call direction handler -> `BidderService` -> usecase -> usecase db.
- Explicit return types on every function/method (`@typescript-eslint/explicit-function-return-type`). No single-letter names (except `i`/`j`/`k` in indexed loops). No inline `if`; blank line before `if`/`for`/`return`/`throw` unless first in block. Constructor parameter properties are `readonly`. Numeric separators on literals of 5+ digits. No barrel files. No comments unless a non-obvious why.
- Errors are snake_case codes; human-readable detail goes to `Logger` (`warn` for not-found, `error` for contract breaks). Pure helpers throw only the code and never log.
- Branded ids: `StripeCustomerId`, `StripePaymentMethodId`, `StripeSetupIntentId` from `src/common/stripe-ids.ts` through the validating constructors, never a blind `as` in production code.
- Tests: Vitest, nested `describe('when ...')` per branch, `it` titles state only the outcome, shared setup in that `describe`'s `beforeEach`.
- No new dependencies, no env vars.
- The card write sets `defaultPaymentMethodId`, `cardBrand`, `cardLast4` AND `tokenVersion: { increment: 1 }` in ONE `updateMany`, first-write-wins (`defaultPaymentMethodId: null` in the `where`).
- Commits: Conventional Commits, lowercase imperative. Per project workflow, stage and stop for the user's `/crit` review before committing implementation work; commit locally only if a rebase needs it. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Verify before declaring a task done: `npm run lint`, `npm run lint:arch`, `npm run typecheck`, `npm test`, and for int specs `npm run test:integration` (needs the local Postgres on port 5435).

## File structure

PR A:
- Create `prisma/migrations/20261116090000_add_bidder_token_version_trigger/migration.sql`
- Create `src/bidders/bidder-token-version-trigger.int.spec.ts`

PR B:
- Create `src/bidders/usecases/sync-payment-method/sync-payment-method.usecase.db.ts` (+ `.spec.ts`)
- Create `src/bidders/usecases/sync-payment-method/sync-payment-method.usecase.ts` (+ `.spec.ts`, `.int.spec.ts`)
- Create `src/bidders/usecases/sync-payment-method/sync-payment-method.module.ts`
- Modify `src/bidders/bidder.service.ts` (+ `bidder.service.spec.ts`): delegate `syncPaymentMethod`
- Create `src/bidders/setup-intent-succeeded.handler.ts` (+ `.spec.ts`, `.int.spec.ts`)
- Modify `src/bidders/bidders.module.ts`
- Modify `docs/runbooks/stripe-connect-setup.md`, `README.md`

---

## PR A

### Task 1: Token version trigger migration

**Files:**
- Create: `prisma/migrations/20261116090000_add_bidder_token_version_trigger/migration.sql`
- Test: `src/bidders/bidder-token-version-trigger.int.spec.ts`

**Interfaces:**
- Consumes: `bidders.default_payment_method_id`, `bidders.token_version` (migration `20261115090000_add_bidder_payment_method`).
- Produces: DB invariant "any UPDATE that changes `default_payment_method_id` sets `token_version = OLD.token_version + 1`", absolute (not additive) so an explicit app-level `token_version + 1` in the same statement does not double-bump.

- [ ] **Step 1: Write the failing integration spec**

Follow the pattern of `src/bidders/usecases/create-payment-setup/create-payment-setup.usecase.int.spec.ts` (throwaway database, `requireReachableInCi`, `describe.skipIf(!reachable)`).

```ts
import type { PrismaService } from '../prisma/prisma.service';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../testing/throwaway-database';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);

describe.skipIf(!reachable)('bidders token_version trigger (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;

  async function versionOf(email: string): Promise<number> {
    const row = await prisma.bidder.findUniqueOrThrow({ where: { email } });

    return row.tokenVersion;
  }

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
  });

  afterAll(async () => {
    await database?.drop();
  });

  describe('when a bidder is inserted with a card', () => {
    it('starts at version 0', async () => {
      await prisma.bidder.create({
        data: { email: 'insert@x.com', defaultPaymentMethodId: 'pm_1', cardBrand: 'visa', cardLast4: '4242' },
      });

      expect(await versionOf('insert@x.com')).toBe(0);
    });
  });

  describe('when default_payment_method_id changes', () => {
    beforeEach(async () => {
      await prisma.bidder.create({ data: { email: 'card@x.com' } });
    });

    afterEach(async () => {
      await prisma.bidder.deleteMany({ where: { email: 'card@x.com' } });
    });

    it('bumps the version once when the card is set', async () => {
      await prisma.$executeRaw`
        UPDATE "bidders"
        SET "default_payment_method_id" = 'pm_1', "card_brand" = 'visa', "card_last4" = '4242'
        WHERE "email" = 'card@x.com'`;

      expect(await versionOf('card@x.com')).toBe(1);
    });

    it('does not double-bump when the statement also increments the version', async () => {
      await prisma.$executeRaw`
        UPDATE "bidders"
        SET "default_payment_method_id" = 'pm_1', "card_brand" = 'visa', "card_last4" = '4242',
            "token_version" = "token_version" + 1
        WHERE "email" = 'card@x.com'`;

      expect(await versionOf('card@x.com')).toBe(1);
    });

    it('bumps the version when the card is cleared', async () => {
      await prisma.$executeRaw`
        UPDATE "bidders"
        SET "default_payment_method_id" = 'pm_1', "card_brand" = 'visa', "card_last4" = '4242'
        WHERE "email" = 'card@x.com'`;
      await prisma.$executeRaw`
        UPDATE "bidders"
        SET "default_payment_method_id" = NULL, "card_brand" = NULL, "card_last4" = NULL
        WHERE "email" = 'card@x.com'`;

      expect(await versionOf('card@x.com')).toBe(2);
    });
  });

  describe('when another column changes', () => {
    it('leaves the version alone', async () => {
      await prisma.bidder.create({ data: { email: 'other@x.com' } });
      await prisma.bidder.update({ where: { email: 'other@x.com' }, data: { stripeCustomerId: 'cus_trigger_1' } });

      expect(await versionOf('other@x.com')).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts src/bidders/bidder-token-version-trigger.int.spec.ts`
Expected: FAIL (`bumps the version once when the card is set` gets 0, `bumps ... cleared` gets 0).

- [ ] **Step 3: Write the migration**

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

- [ ] **Step 4: Run to verify it passes, and re-run the HYR-59 int spec**

Run: `npx vitest run --config vitest.integration.config.ts src/bidders`
Expected: PASS, including `create-payment-setup.usecase.int.spec.ts` (its `giveCard` helper increments explicitly, result stays +1).
Also run: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <throwaway url>` and confirm empty (triggers are not modelled).

- [ ] **Step 5: Stage** `prisma/migrations/20261116090000_add_bidder_token_version_trigger src/bidders/bidder-token-version-trigger.int.spec.ts`. Suggested message: `feat(bidders): bump token version on payment method change`.

---

## PR B1 (Tasks 2-4) and PR B2 (Tasks 5-6)

### Task 2: Usecase db

**Files:**
- Create: `src/bidders/usecases/sync-payment-method/sync-payment-method.usecase.db.ts`
- Test: `src/bidders/usecases/sync-payment-method/sync-payment-method.usecase.db.spec.ts`

**Interfaces:**
- Produces:
  - `SyncPaymentMethodUsecaseDb.findByStripeCustomerId(customerId: StripeCustomerId): Promise<Bidder | null>`
  - `SyncPaymentMethodUsecaseDb.saveFirstCard(input: SaveFirstCardInput): Promise<boolean>` where `SaveFirstCardInput = { customerId: StripeCustomerId; paymentMethodId: StripePaymentMethodId; brand: string; last4: string }`; `true` iff one row was updated.

- [ ] **Step 1: Write the failing spec.** Copy the structure of `create-payment-setup.usecase.db.spec.ts` (mock `PrismaService` with `mockDeep`).

```ts
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { StripeCustomerId, StripePaymentMethodId } from '../../../common/stripe-ids';
import type { PrismaService } from '../../../prisma/prisma.service';
import { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

describe('SyncPaymentMethodUsecaseDb', () => {
  const customerId = 'cus_1' as StripeCustomerId;
  const paymentMethodId = 'pm_1' as StripePaymentMethodId;
  let prisma: DeepMockProxy<PrismaService>;
  let db: SyncPaymentMethodUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new SyncPaymentMethodUsecaseDb(prisma);
  });

  describe('findByStripeCustomerId', () => {
    it('looks the bidder up by the unique customer id', async () => {
      prisma.bidder.findUnique.mockResolvedValue(null);

      await db.findByStripeCustomerId(customerId);

      expect(prisma.bidder.findUnique).toHaveBeenCalledWith({ where: { stripeCustomerId: customerId } });
    });
  });

  describe('saveFirstCard', () => {
    it('writes card and version bump in one conditional update', async () => {
      prisma.bidder.updateMany.mockResolvedValue({ count: 1 });

      await db.saveFirstCard({ customerId, paymentMethodId, brand: 'visa', last4: '4242' });

      expect(prisma.bidder.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.bidder.updateMany).toHaveBeenCalledWith({
        where: { stripeCustomerId: customerId, defaultPaymentMethodId: null },
        data: {
          defaultPaymentMethodId: paymentMethodId,
          cardBrand: 'visa',
          cardLast4: '4242',
          tokenVersion: { increment: 1 },
        },
      });
    });

    describe('when a row was updated', () => {
      it('returns true', async () => {
        prisma.bidder.updateMany.mockResolvedValue({ count: 1 });

        expect(await db.saveFirstCard({ customerId, paymentMethodId, brand: 'visa', last4: '4242' })).toBe(true);
      });
    });

    describe('when no row matched', () => {
      it('returns false', async () => {
        prisma.bidder.updateMany.mockResolvedValue({ count: 0 });

        expect(await db.saveFirstCard({ customerId, paymentMethodId, brand: 'visa', last4: '4242' })).toBe(false);
      });
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`npx vitest run src/bidders/usecases/sync-payment-method/sync-payment-method.usecase.db.spec.ts`: module not found).

- [ ] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { Bidder } from '@prisma/client';
import type { StripeCustomerId, StripePaymentMethodId } from '../../../common/stripe-ids';
import { PrismaService } from '../../../prisma/prisma.service';

export type SaveFirstCardInput = {
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
  brand: string;
  last4: string;
};

@Injectable()
export class SyncPaymentMethodUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  findByStripeCustomerId(customerId: StripeCustomerId): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { stripeCustomerId: customerId } });
  }

  async saveFirstCard(input: SaveFirstCardInput): Promise<boolean> {
    const result = await this.prisma.bidder.updateMany({
      where: { stripeCustomerId: input.customerId, defaultPaymentMethodId: null },
      data: {
        defaultPaymentMethodId: input.paymentMethodId,
        cardBrand: input.brand,
        cardLast4: input.last4,
        tokenVersion: { increment: 1 },
      },
    });

    return result.count > 0;
  }
}
```

- [ ] **Step 4: Run, expect PASS.** Also `npm run lint:arch` (Prisma only in `*.db.ts`).
- [ ] **Step 5: Stage** the two files. Suggested: `feat(bidders): add sync payment method usecase db`.

### Task 3: Usecase

**Files:**
- Create: `src/bidders/usecases/sync-payment-method/sync-payment-method.usecase.ts`
- Test: `src/bidders/usecases/sync-payment-method/sync-payment-method.usecase.spec.ts`

**Interfaces:**
- Consumes: `SyncPaymentMethodUsecaseDb` (Task 2), `StripeGateway.retrievePaymentMethod(id: StripePaymentMethodId): Promise<PaymentMethodSnapshot>`.
- Produces: `SyncPaymentMethodCommand`, `SyncPaymentMethodOutcome`, `SyncPaymentMethodUsecase.execute(command: SyncPaymentMethodCommand): Promise<SyncPaymentMethodOutcome>`.

- [ ] **Step 1: Write the failing spec**

```ts
import { Logger } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { StripeCustomerId, StripePaymentMethodId, StripeSetupIntentId } from '../../../common/stripe-ids';
import type { StripeGateway } from '../../../stripe/stripe-gateway';
import { SyncPaymentMethodUsecase, type SyncPaymentMethodCommand } from './sync-payment-method.usecase';
import type { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

describe('SyncPaymentMethodUsecase', () => {
  const command: SyncPaymentMethodCommand = {
    setupIntentId: 'seti_1' as StripeSetupIntentId,
    customerId: 'cus_1' as StripeCustomerId,
    paymentMethodId: 'pm_1' as StripePaymentMethodId,
  };
  let db: DeepMockProxy<SyncPaymentMethodUsecaseDb>;
  let gateway: DeepMockProxy<StripeGateway>;
  let usecase: SyncPaymentMethodUsecase;

  function row(defaultPaymentMethodId: string | null): never {
    return { id: 'bidder-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId } as never;
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    db = mockDeep<SyncPaymentMethodUsecaseDb>();
    gateway = mockDeep<StripeGateway>();
    gateway.retrievePaymentMethod.mockResolvedValue({
      id: command.paymentMethodId,
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
    usecase = new SyncPaymentMethodUsecase(db, gateway);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when no bidder has the customer id', () => {
    beforeEach(() => {
      db.findByStripeCustomerId.mockResolvedValue(null);
    });

    it('reports unknown_customer', async () => {
      expect(await usecase.execute(command)).toBe('unknown_customer');
    });

    it('does not call Stripe or write', async () => {
      await usecase.execute(command);

      expect(gateway.retrievePaymentMethod).not.toHaveBeenCalled();
      expect(db.saveFirstCard).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder already has this card', () => {
    beforeEach(() => {
      db.findByStripeCustomerId.mockResolvedValue(row('pm_1'));
    });

    it('reports already_saved', async () => {
      expect(await usecase.execute(command)).toBe('already_saved');
    });

    it('does not call Stripe or write', async () => {
      await usecase.execute(command);

      expect(gateway.retrievePaymentMethod).not.toHaveBeenCalled();
      expect(db.saveFirstCard).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder already has another card', () => {
    beforeEach(() => {
      db.findByStripeCustomerId.mockResolvedValue(row('pm_other'));
    });

    it('reports ignored_existing_card', async () => {
      expect(await usecase.execute(command)).toBe('ignored_existing_card');
    });

    it('does not call Stripe or write', async () => {
      await usecase.execute(command);

      expect(gateway.retrievePaymentMethod).not.toHaveBeenCalled();
      expect(db.saveFirstCard).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder has no card', () => {
    beforeEach(() => {
      db.findByStripeCustomerId.mockResolvedValue(row(null));
      db.saveFirstCard.mockResolvedValue(true);
    });

    it('saves brand and last4 from the retrieved payment method', async () => {
      await usecase.execute(command);

      expect(gateway.retrievePaymentMethod).toHaveBeenCalledWith(command.paymentMethodId);
      expect(db.saveFirstCard).toHaveBeenCalledWith({
        customerId: command.customerId,
        paymentMethodId: command.paymentMethodId,
        brand: 'visa',
        last4: '4242',
      });
    });

    it('reports saved', async () => {
      expect(await usecase.execute(command)).toBe('saved');
    });

    describe('when Stripe fails', () => {
      it('propagates and writes nothing', async () => {
        gateway.retrievePaymentMethod.mockRejectedValue(new Error('stripe_unavailable'));

        await expect(usecase.execute(command)).rejects.toThrow('stripe_unavailable');
        expect(db.saveFirstCard).not.toHaveBeenCalled();
      });
    });

    describe('when last4 is not four digits', () => {
      beforeEach(() => {
        gateway.retrievePaymentMethod.mockResolvedValue({
          id: command.paymentMethodId,
          brand: 'visa',
          last4: '42',
          expMonth: 12,
          expYear: 2030,
        });
      });

      it('reports invalid_card_data and writes nothing', async () => {
        expect(await usecase.execute(command)).toBe('invalid_card_data');
        expect(db.saveFirstCard).not.toHaveBeenCalled();
      });
    });

    describe('when brand is empty', () => {
      it('reports invalid_card_data', async () => {
        gateway.retrievePaymentMethod.mockResolvedValue({
          id: command.paymentMethodId,
          brand: ' ',
          last4: '4242',
          expMonth: 12,
          expYear: 2030,
        });

        expect(await usecase.execute(command)).toBe('invalid_card_data');
      });
    });

    describe('when another event wins the write', () => {
      beforeEach(() => {
        db.saveFirstCard.mockResolvedValue(false);
      });

      it('reports already_saved if the winner saved the same card', async () => {
        db.findByStripeCustomerId.mockResolvedValueOnce(row(null)).mockResolvedValueOnce(row('pm_1'));

        expect(await usecase.execute(command)).toBe('already_saved');
      });

      it('reports ignored_existing_card if the winner saved another card', async () => {
        db.findByStripeCustomerId.mockResolvedValueOnce(row(null)).mockResolvedValueOnce(row('pm_other'));

        expect(await usecase.execute(command)).toBe('ignored_existing_card');
      });

      it('reports unknown_customer if the bidder vanished', async () => {
        db.findByStripeCustomerId.mockResolvedValueOnce(row(null)).mockResolvedValueOnce(null);

        expect(await usecase.execute(command)).toBe('unknown_customer');
      });
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { StripeCustomerId, StripePaymentMethodId, StripeSetupIntentId } from '../../../common/stripe-ids';
import { StripeGateway } from '../../../stripe/stripe-gateway';
import { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

const LAST4_PATTERN = /^[0-9]{4}$/;

export type SyncPaymentMethodCommand = {
  setupIntentId: StripeSetupIntentId;
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
};

export type SyncPaymentMethodOutcome =
  | 'saved'
  | 'already_saved'
  | 'ignored_existing_card'
  | 'unknown_customer'
  | 'invalid_card_data';

@Injectable()
export class SyncPaymentMethodUsecase {
  private readonly logger = new Logger(SyncPaymentMethodUsecase.name);

  constructor(
    private readonly db: SyncPaymentMethodUsecaseDb,
    private readonly gateway: StripeGateway,
  ) {}

  async execute(command: SyncPaymentMethodCommand): Promise<SyncPaymentMethodOutcome> {
    const bidder = await this.db.findByStripeCustomerId(command.customerId);

    if (!bidder) {
      this.logger.warn(`Setup intent ${command.setupIntentId} succeeded for unknown customer ${command.customerId}`);

      return 'unknown_customer';
    }

    if (bidder.defaultPaymentMethodId != null) {
      return this.classifyExisting(bidder.defaultPaymentMethodId, command);
    }

    const card = await this.gateway.retrievePaymentMethod(command.paymentMethodId);

    if (!LAST4_PATTERN.test(card.last4) || card.brand.trim() === '') {
      this.logger.error(`Payment method ${command.paymentMethodId} has unusable card data, not saved`);

      return 'invalid_card_data';
    }

    const saved = await this.db.saveFirstCard({
      customerId: command.customerId,
      paymentMethodId: command.paymentMethodId,
      brand: card.brand,
      last4: card.last4,
    });

    if (saved) {
      this.logger.log(`Saved payment method ${command.paymentMethodId} for bidder ${bidder.id}`);

      return 'saved';
    }

    const current = await this.db.findByStripeCustomerId(command.customerId);

    if (current?.defaultPaymentMethodId == null) {
      this.logger.warn(`Bidder for customer ${command.customerId} vanished while saving ${command.paymentMethodId}`);

      return 'unknown_customer';
    }

    return this.classifyExisting(current.defaultPaymentMethodId, command);
  }

  private classifyExisting(existingId: string, command: SyncPaymentMethodCommand): SyncPaymentMethodOutcome {
    if (existingId === command.paymentMethodId) {
      this.logger.debug(`Payment method ${command.paymentMethodId} already saved (setup intent ${command.setupIntentId})`);

      return 'already_saved';
    }

    this.logger.warn(
      `Ignored payment method ${command.paymentMethodId} from setup intent ${command.setupIntentId}: customer ${command.customerId} already has ${existingId}`,
    );

    return 'ignored_existing_card';
  }
}
```

- [ ] **Step 4: Run, expect PASS.** `npm run lint` and `npm run typecheck`.
- [ ] **Step 5: Stage.** Suggested: `feat(bidders): add sync payment method usecase`.

### Task 4: Module, service delegate, usecase integration spec

**Files:**
- Create: `src/bidders/usecases/sync-payment-method/sync-payment-method.module.ts`
- Modify: `src/bidders/bidder.service.ts` (constructor + delegate), `src/bidders/bidder.service.spec.ts` (constructor call + one delegate case)
- Modify: `src/bidders/bidders.module.ts`
- Test: `src/bidders/usecases/sync-payment-method/sync-payment-method.usecase.int.spec.ts`

**Interfaces:**
- Consumes: `SyncPaymentMethodUsecase` (Task 3).
- Produces: `BidderService.syncPaymentMethod(command: SyncPaymentMethodCommand): Promise<SyncPaymentMethodOutcome>`; `BiddersModule` provides everything needed for Task 5.

- [ ] **Step 1: Write the failing int spec** (pattern: `create-payment-setup.usecase.int.spec.ts`; real `SyncPaymentMethodUsecaseDb`, fake gateway returning a snapshot keyed by id; a per-test bidder with `stripeCustomerId`).

```ts
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { stripeCustomerId, stripePaymentMethodId, stripeSetupIntentId } from '../../../common/stripe-ids';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { StripeGateway } from '../../../stripe/stripe-gateway';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../../../testing/throwaway-database';
import { BidderTokenService } from '../../bidder-token.service';
import { SyncPaymentMethodUsecase } from './sync-payment-method.usecase';
import { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);

describe.skipIf(!reachable)('SyncPaymentMethodUsecase (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let usecase: SyncPaymentMethodUsecase;

  function commandFor(customer: string, paymentMethod: string): Parameters<SyncPaymentMethodUsecase['execute']>[0] {
    return {
      setupIntentId: stripeSetupIntentId(`seti_${paymentMethod}`),
      customerId: stripeCustomerId(customer),
      paymentMethodId: stripePaymentMethodId(paymentMethod),
    };
  }

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
    const gateway = {
      retrievePaymentMethod: async (id: string) => ({ id, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }),
    } as unknown as StripeGateway;

    usecase = new SyncPaymentMethodUsecase(new SyncPaymentMethodUsecaseDb(prisma), gateway);
  });

  afterAll(async () => {
    await database?.drop();
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when a bidder without a card gets its first event', () => {
    it('saves the card and bumps the version exactly once', async () => {
      await prisma.bidder.create({ data: { email: 'first@x.com', stripeCustomerId: 'cus_first' } });

      expect(await usecase.execute(commandFor('cus_first', 'pm_first'))).toBe('saved');

      const row = await prisma.bidder.findUniqueOrThrow({ where: { email: 'first@x.com' } });

      expect(row).toMatchObject({
        defaultPaymentMethodId: 'pm_first',
        cardBrand: 'visa',
        cardLast4: '4242',
        tokenVersion: 1,
      });
    });
  });

  describe('when the same event is processed twice', () => {
    it('keeps one write and one version bump', async () => {
      await prisma.bidder.create({ data: { email: 'replay@x.com', stripeCustomerId: 'cus_replay' } });

      await usecase.execute(commandFor('cus_replay', 'pm_replay'));

      expect(await usecase.execute(commandFor('cus_replay', 'pm_replay'))).toBe('already_saved');
      expect((await prisma.bidder.findUniqueOrThrow({ where: { email: 'replay@x.com' } })).tokenVersion).toBe(1);
    });
  });

  describe('when a second card arrives', () => {
    it('is ignored and leaves the first card and version', async () => {
      await prisma.bidder.create({ data: { email: 'second@x.com', stripeCustomerId: 'cus_second' } });

      await usecase.execute(commandFor('cus_second', 'pm_one'));

      expect(await usecase.execute(commandFor('cus_second', 'pm_two'))).toBe('ignored_existing_card');

      const row = await prisma.bidder.findUniqueOrThrow({ where: { email: 'second@x.com' } });

      expect(row).toMatchObject({ defaultPaymentMethodId: 'pm_one', tokenVersion: 1 });
    });
  });

  describe('when the customer is unknown', () => {
    it('writes nothing', async () => {
      expect(await usecase.execute(commandFor('cus_nobody', 'pm_x'))).toBe('unknown_customer');
    });
  });

  describe('when two different cards race for the same bidder', () => {
    it('saves exactly one and bumps once', async () => {
      await prisma.bidder.create({ data: { email: 'race@x.com', stripeCustomerId: 'cus_race' } });

      const outcomes = await Promise.all([
        usecase.execute(commandFor('cus_race', 'pm_a')),
        usecase.execute(commandFor('cus_race', 'pm_b')),
      ]);

      expect([...outcomes].sort()).toEqual(['ignored_existing_card', 'saved']);
      expect((await prisma.bidder.findUniqueOrThrow({ where: { email: 'race@x.com' } })).tokenVersion).toBe(1);
    });
  });

  describe('when a token was issued before the card was saved', () => {
    it('no longer matches the bidder version afterwards', async () => {
      const bidder = await prisma.bidder.create({ data: { email: 'token@x.com', stripeCustomerId: 'cus_token' } });
      const tokens = new BidderTokenService(new JwtService({ secret: 'integration-secret-integration-secret' }), {
        ttlSeconds: 3600,
      });
      const issued = await tokens.issue(bidder.id as never, bidder.tokenVersion);

      await usecase.execute(commandFor('cus_token', 'pm_token'));

      const verified = await tokens.verify(issued.token);
      const after = await prisma.bidder.findUniqueOrThrow({ where: { id: bidder.id } });

      expect(verified.tokenVersion).not.toBe(after.tokenVersion);
    });
  });
});
```

(Adjust the `BidderTokenService` constructor call and `issue` typing to match the real signatures in `bidder-token.service.ts`, as `create-payment-setup.usecase.int.spec.ts` does.)

- [ ] **Step 2: Run, expect FAIL** (`npx vitest run --config vitest.integration.config.ts src/bidders/usecases/sync-payment-method`): module wiring is not needed for this spec, it fails only if Tasks 2-3 are absent; if they exist it passes. Treat this step as the red/green check of the real SQL.

- [ ] **Step 3: Module and delegate**

`sync-payment-method.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StripeModule } from '../../../stripe/stripe.module';
import { SyncPaymentMethodUsecase } from './sync-payment-method.usecase';
import { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

@Module({
  imports: [StripeModule],
  providers: [SyncPaymentMethodUsecase, SyncPaymentMethodUsecaseDb],
  exports: [SyncPaymentMethodUsecase],
})
export class SyncPaymentMethodModule {}
```

`bidder.service.ts`: add `private readonly syncPaymentMethodUsecase: SyncPaymentMethodUsecase` as the third constructor parameter and

```ts
  syncPaymentMethod(command: SyncPaymentMethodCommand): Promise<SyncPaymentMethodOutcome> {
    return this.syncPaymentMethodUsecase.execute(command);
  }
```

(import `SyncPaymentMethodUsecase`, `SyncPaymentMethodCommand`, `SyncPaymentMethodOutcome` from `./usecases/sync-payment-method/sync-payment-method.usecase`). `bidders.module.ts`: add `SyncPaymentMethodModule` to `imports`.

`bidder.service.spec.ts`: pass a `mockDeep<SyncPaymentMethodUsecase>()` in every `new BidderService(...)`, and add:

```ts
  describe('syncPaymentMethod', () => {
    it('delegates to the usecase', async () => {
      syncUsecase.execute.mockResolvedValue('saved');

      expect(await service.syncPaymentMethod(command)).toBe('saved');
      expect(syncUsecase.execute).toHaveBeenCalledWith(command);
    });
  });
```

- [ ] **Step 4: Run** `npm test`, `npm run test:integration -- src/bidders`, `npm run typecheck`, `npm run lint:arch`. Expected: PASS.
- [ ] **Step 5: Stage.** Suggested: `feat(bidders): wire sync payment method usecase`.

(PR B1 ends here.)

### Task 5: Handler and registration

**Files:**
- Create: `src/bidders/setup-intent-succeeded.handler.ts`
- Modify: `src/bidders/bidders.module.ts` (import `StripeModule`, provide the handler)
- Test: `src/bidders/setup-intent-succeeded.handler.spec.ts`

**Interfaces:**
- Consumes: `BidderService.syncPaymentMethod(command)`, `StripeEventHandlerRegistry.register`, `stripeCustomerId`, `stripePaymentMethodId`, `stripeSetupIntentId`, `InvalidValueError` (`src/common/domain-error`).
- Produces: `SetupIntentSucceededHandler` registered for `setup_intent.succeeded`.

- [ ] **Step 1: Write the failing spec** (pattern: `connect-account-updated.handler.spec.ts`).

```ts
import { Logger } from '@nestjs/common';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { StripeEvent } from '../stripe/stripe-gateway';
import type { StripeEventHandlerRegistry } from '../stripe/webhooks/stripe-event-handler-registry';
import { stripeConnectAccountId } from '../common/stripe-ids';
import type { BidderService } from './bidder.service';
import { SetupIntentSucceededHandler } from './setup-intent-succeeded.handler';

function eventWith(data: Record<string, unknown>, accountId: StripeEvent['accountId'] = null): StripeEvent {
  return { id: 'evt_1', type: 'setup_intent.succeeded', created: new Date('2026-11-16T10:00:00Z'), accountId, data };
}

const validData = { id: 'seti_1', customer: 'cus_1', payment_method: 'pm_1', payment_method_types: ['card'] };

describe('SetupIntentSucceededHandler', () => {
  let bidders: MockProxy<BidderService>;
  let registry: MockProxy<StripeEventHandlerRegistry>;
  let handler: SetupIntentSucceededHandler;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    bidders = mock<BidderService>();
    registry = mock<StripeEventHandlerRegistry>();
    handler = new SetupIntentSucceededHandler(bidders, registry);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handles', () => {
    it('accepts setup_intent.succeeded only', () => {
      expect(handler.handles('setup_intent.succeeded')).toBe(true);
      expect(handler.handles('setup_intent.setup_failed')).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    it('registers itself', () => {
      handler.onModuleInit();

      expect(registry.register).toHaveBeenCalledWith(handler);
    });
  });

  describe('when the event is valid', () => {
    it('delegates a branded command', async () => {
      await handler.handle(eventWith(validData));

      expect(bidders.syncPaymentMethod).toHaveBeenCalledWith({
        setupIntentId: 'seti_1',
        customerId: 'cus_1',
        paymentMethodId: 'pm_1',
      });
    });

    describe('when the usecase fails', () => {
      it('propagates so the claim is released', async () => {
        bidders.syncPaymentMethod.mockRejectedValue(new Error('stripe_unavailable'));

        await expect(handler.handle(eventWith(validData))).rejects.toThrow('stripe_unavailable');
      });
    });
  });

  describe('when the event belongs to a connected account', () => {
    it('does nothing', async () => {
      await handler.handle(eventWith(validData, stripeConnectAccountId('acct_1')));

      expect(bidders.syncPaymentMethod).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['payment_method_types is not exactly card', { ...validData, payment_method_types: ['card', 'link'] }],
    ['payment_method_types is missing', { ...validData, payment_method_types: undefined }],
    ['customer is null', { ...validData, customer: null }],
    ['customer is an expanded object', { ...validData, customer: { id: 'cus_1' } }],
    ['payment_method is missing', { ...validData, payment_method: undefined }],
    ['id is malformed', { ...validData, id: 'bad' }],
    ['customer id is malformed', { ...validData, customer: 'bad' }],
    ['payment method id is malformed', { ...validData, payment_method: 'bad' }],
  ])('when %s', (_label, data) => {
    it('acks without calling the service', async () => {
      await expect(handler.handle(eventWith(data))).resolves.toBeUndefined();
      expect(bidders.syncPaymentMethod).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InvalidValueError } from '../common/domain-error';
import { stripeCustomerId, stripePaymentMethodId, stripeSetupIntentId } from '../common/stripe-ids';
import type { StripeEvent } from '../stripe/stripe-gateway';
import { StripeEventHandler } from '../stripe/webhooks/stripe-event-handler';
import { StripeEventHandlerRegistry } from '../stripe/webhooks/stripe-event-handler-registry';
import { BidderService } from './bidder.service';
import type { SyncPaymentMethodCommand } from './usecases/sync-payment-method/sync-payment-method.usecase';

@Injectable()
export class SetupIntentSucceededHandler extends StripeEventHandler implements OnModuleInit {
  private readonly logger = new Logger(SetupIntentSucceededHandler.name);

  constructor(
    private readonly bidders: BidderService,
    private readonly registry: StripeEventHandlerRegistry,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  handles(type: string): boolean {
    return type === 'setup_intent.succeeded';
  }

  async handle(event: StripeEvent): Promise<void> {
    if (event.accountId != null) {
      this.logger.debug(`Webhook ${event.id} (${event.type}) is for a connected account, ignored`);

      return;
    }

    const command = this.parse(event);

    if (!command) {
      return;
    }

    await this.bidders.syncPaymentMethod(command);
  }

  private parse(event: StripeEvent): SyncPaymentMethodCommand | null {
    const { id, customer, payment_method: paymentMethod, payment_method_types: types } = event.data;

    if (!Array.isArray(types) || types.length !== 1 || types[0] !== 'card') {
      this.logger.warn(`Webhook ${event.id}: setup intent is not card-only, ignored`);

      return null;
    }

    if (typeof id !== 'string' || typeof customer !== 'string' || typeof paymentMethod !== 'string') {
      this.logger.warn(`Webhook ${event.id}: setup intent has no customer or payment method, ignored`);

      return null;
    }

    try {
      return {
        setupIntentId: stripeSetupIntentId(id),
        customerId: stripeCustomerId(customer),
        paymentMethodId: stripePaymentMethodId(paymentMethod),
      };
    } catch (error) {
      if (!(error instanceof InvalidValueError)) {
        throw error;
      }

      this.logger.error(`Webhook ${event.id}: malformed id in setup intent payload (${error.message}), ignored`);

      return null;
    }
  }
}
```

`bidders.module.ts`: add `StripeModule` to `imports` and `SetupIntentSucceededHandler` to `providers`.

- [ ] **Step 4: Run** `npx vitest run src/bidders`, `npm run lint`, `npm run lint:arch`, `npm run typecheck`. Expected: PASS. Confirm that `app.module` boots in the existing app-module/e2e test if one exists (`BidderService` injected into the handler, registry from `StripeModule`).
- [ ] **Step 5: Stage.** Suggested: `feat(bidders): handle setup_intent.succeeded webhook`.

### Task 6: Webhook-level integration spec and docs

**Files:**
- Create: `src/bidders/setup-intent-succeeded.int.spec.ts`
- Modify: `docs/runbooks/stripe-connect-setup.md`, `README.md`

**Interfaces:**
- Consumes: `StripeWebhookService`, `StripeWebhookEventDb`, `StripeEventHandlerRegistry`, `SetupIntentSucceededHandler`, `BidderService`, `SyncPaymentMethodUsecase`, `SyncPaymentMethodUsecaseDb`.

- [ ] **Step 1: Write the spec.** Pattern: `src/stripe/webhooks/stripe-webhook.int.spec.ts` (real `StripeWebhookEventDb` on the throwaway database, fake `StripeGateway` whose `constructWebhookEvent` returns a prepared `StripeEvent` and whose `retrievePaymentMethod` returns a visa 4242). Build `new BidderService(new BidderDb(prisma), {} as never, new SyncPaymentMethodUsecase(new SyncPaymentMethodUsecaseDb(prisma), gateway))`, register `new SetupIntentSucceededHandler(bidders, registry)` through `handler.onModuleInit()`.

Cases (nested `describe('when ...')`):
1. When a valid event is delivered twice with the same event id: bidder row has `tokenVersion` 1, card set; `stripe_webhook_events` row has `processedAt` set; second `receive` resolves without a second `retrievePaymentMethod` call (`toHaveBeenCalledTimes(1)`).
2. When the same card arrives under a new event id (Stripe redelivery with a different id): resolves, `tokenVersion` stays 1.
3. When the gateway `retrievePaymentMethod` rejects: `receive` rejects with `stripe_webhook_handler_failed`, `claimed_at` is null again (released), bidder has no card; a second `receive` with a working gateway then saves the card (retry succeeds).

- [ ] **Step 2: Run, expect PASS** (`npm run test:integration -- src/bidders/setup-intent-succeeded.int.spec.ts`). If case 3 fails, the bug is in the handler/usecase error propagation, not the test.

- [ ] **Step 3: Docs.**
  - `docs/runbooks/stripe-connect-setup.md` section 4 table, Platform row, Events column: `setup_intent.succeeded` (HYR-60; PaymentIntent events come with HYR-11/14). Add under the table: the endpoint API version should match the adapter's pinned version (`2026-10-28.endive`); subscribe after the code is deployed. Section 7: note `stripe trigger setup_intent.succeeded` uses a foreign customer and therefore logs `unknown customer` and writes nothing; to exercise the real path confirm a setup intent created through `POST /bidders/setup-intents` in the Stripe test dashboard or with Stripe.js. Section 9 checklist: `[ ] setup_intent.succeeded subscribed on the platform endpoint, test and live`.
  - `README.md`: short "Bidder card sync (HYR-60)" section next to the HYR-59 one: event and channel, bidder resolved by customer id, first card wins (a second card is ignored and logged), the write bumps `token_version` (and a DB trigger enforces it for any writer), outcomes table (`saved`, `already_saved`, `ignored_existing_card`, `unknown_customer`, `invalid_card_data`), the follow-ups (replace card, `payment_method.detached`).

- [ ] **Step 4: Full check:** `npm run verify:fast` and `npm run test:integration`. Expected: PASS.
- [ ] **Step 5: Stage.** Suggested: `feat(bidders): cover setup intent webhook end to end` and `docs(stripe): subscribe platform endpoint to setup_intent.succeeded`.

---

## Self-review

- Spec coverage: Q1 ignore (Task 3 `ignored_existing_card`, Task 4 int), Q2 gateway retrieve with no port change (Task 3), Q3 card-only handler check (Task 5), Q4 customer id lookup (Task 2), Q5 app increment + trigger (Tasks 2 and 1), Q6 unknown/malformed ack (Tasks 3, 5), Q7 detached out of scope (spec follow-up, README), Q8 replay/ordering (Tasks 3, 4, 6), Q9 deploy config (Task 6 docs), Q10 layering (Tasks 2-5), Q11 last4/brand guard (Task 3).
- Type consistency: `SyncPaymentMethodCommand`, `SyncPaymentMethodOutcome`, `saveFirstCard`, `findByStripeCustomerId` are named identically across Tasks 2-6.
- No placeholders; one flagged adjustment: Task 4's `BidderTokenService` constructor/`issue` call must be matched to the real signatures (copy from the HYR-59 int spec).
- Estimated lines: Task 1 ~110, Task 2 ~85, Task 3 ~260, Task 4 ~210, Task 5 ~190, Task 6 ~100 + docs 40. B1 ~555, B2 ~330, A ~110.
