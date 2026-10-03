# HYR-4: Guest Bidder Identity Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the email-keyed, password-less `Bidder` a validated, DB-guarded identity with a small service API (get-or-create, get-by-id, attach Stripe customer), without any HTTP surface.

**Architecture:** Extend the existing `src/bidders` module (service/db split, no usecase layer). Validation lives in the pure `normalizeEmail` helper; the lowercase invariant is also enforced by a hand-written Postgres CHECK; `stripe_customer_id` becomes unique. All in a new migration on top of the merged HYR-2 init migration.

**Tech Stack:** Node 24, NestJS 12 (ESM), Prisma 6.19.3, PostgreSQL 16, Vitest 5 with `vitest-mock-extended`.

**Spec:** `docs/specs/2026-10-01-guest-bidder-identity-design.md`

## Global Constraints

- No new dependencies. If one becomes necessary, pin it to an exact version (no `^`/`~`).
- Explicit return type on every function/method (`@typescript-eslint/explicit-function-return-type: error`), including `Promise<void>`.
- No single-letter variables (except `i`/`j`/`k` in indexed `for`), no inline `if` (always braced, body on its own line), blank line before `if`/`for`/`while`/`return`/`throw` unless first in block, no `!!x`.
- Constructor parameter properties are `private readonly`.
- Native ESM: every relative import carries `.js` (e.g. `../common/ids.js`). No barrel files.
- `*.service.ts` never imports `@prisma/client`; only `*.db.ts` does (enforced by `npm run lint:arch`).
- Branded types: `BidderId`, `NormalizedEmail`, `StripeCustomerId` in service/db signatures. Services never cast to a brand.
- Errors are snake_case codes (`email_invalid`, `bidder_not_found`, `bidder_stripe_customer_conflict`); readable detail goes to the class `Logger` at the throw site (`warn`). Pure helpers in `src/common` throw `InvalidValueError('<code>')` (a `DomainError`, mapped to HTTP by the global `DomainErrorFilter`) and never log. Do not log raw emails (PII).
- Postgres names are snake_case. Hand-written SQL in migrations is marked `-- Hand-written`.
- Do not edit `prisma/migrations/20260929090000_init`; add a new migration.
- Tests: nested `describe` per condition (`when ...`), short `it` titles stating only the outcome, shared setup in that `describe`'s `beforeEach`. Service specs use `Test.createTestingModule` with `{ provide: BidderDb, useValue: mockDeep<BidderDb>() }`. Helper specs in `src/common` stay plain.
- Delete dead code; no comments unless a non-obvious why.
- Commits: Conventional Commits, lowercase imperative summary, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage and stop for user review before committing anything beyond trivial changes (user runs `/crit`).

## File Structure

- Modify `src/common/email.ts` and `src/common/email.spec.ts`: validation in `normalizeEmail`.
- Modify `prisma/schema.prisma`: `@unique` on `Bidder.stripeCustomerId`.
- Create `prisma/migrations/<timestamp>_bidder_identity/migration.sql`: unique index + CHECK.
- Modify `src/bidders/bidder.db.ts`: `findById`, `setStripeCustomerIdIfUnset`.
- Modify `src/bidders/bidder.service.ts` and `bidder.service.spec.ts`: validation error mapping, `getById`, `attachStripeCustomer`.
- `src/bidders/bidders.module.ts`: unchanged.

---

### Task 1: Validate emails in normalizeEmail

**Files:**
- Modify: `src/common/email.ts`
- Test: `src/common/email.spec.ts`

**Interfaces:**
- Consumes: `Brand` from `src/common/brand.ts`.
- Produces: `normalizeEmail(raw: string): NormalizedEmail`, throws `InvalidValueError('email_invalid')` when the trimmed, lowercased value is longer than 254 chars or does not match the pattern. Signature unchanged.

- [ ] **Step 1: Add failing tests** (append inside `src/common/email.spec.ts`, keep existing cases)

```ts
describe('normalizeEmail validation', () => {
  describe.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['missing @', 'jamie.example.com'],
    ['two @', 'a@b@example.com'],
    ['empty local part', '@example.com'],
    ['empty domain', 'jamie@'],
    ['domain without a dot', 'jamie@localhost'],
    ['consecutive dots in domain', 'jamie@example..com'],
    ['trailing dot in domain', 'jamie@example.com.'],
    ['internal whitespace', 'ja mie@example.com'],
    ['longer than 254 characters', `${'a'.repeat(250)}@example.com`],
  ])('when the email is %s', (_label, raw) => {
    it('throws email_invalid', () => {
      expect(() => normalizeEmail(raw)).toThrow('email_invalid');
    });
  });

  describe('when the email has plus tags and dots in the local part', () => {
    it('keeps them untouched', () => {
      expect(normalizeEmail('Ja.Mie+Hyrox@Example.com')).toBe('ja.mie+hyrox@example.com');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/common/email.spec.ts`
Expected: the new invalid-input cases FAIL (no throw); old cases pass.

- [ ] **Step 3: Implement**

```ts
import type { Brand } from './brand.js';

export type NormalizedEmail = Brand<string, 'NormalizedEmail'>;

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(raw: string): NormalizedEmail {
  const email = raw.trim().toLowerCase();

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new InvalidValueError('email_invalid');
  }

  return email as NormalizedEmail;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/common/email.spec.ts`
Expected: PASS (existing `a@b.c` type-check case still valid).

- [ ] **Step 5: Stage**

```bash
git add src/common/email.ts src/common/email.spec.ts
```
Commit message when approved: `feat(common): validate emails in normalizeEmail`.

---

### Task 2: Schema and migration (unique Stripe customer, normalised-email CHECK)

**Files:**
- Modify: `prisma/schema.prisma` (model `Bidder`)
- Create: `prisma/migrations/<timestamp>_bidder_identity/migration.sql`

**Interfaces:**
- Consumes: local Postgres from `docker-compose.yml` with `DATABASE_URL` set per `.env.example`.
- Produces: `Bidder.stripeCustomerId` unique; table `bidders` rejects any `email` that is not already `lower(btrim(email))`. Prisma client type `Bidder` is otherwise unchanged.

- [ ] **Step 1: Edit schema.** In `model Bidder`, change the field to:

```prisma
  stripeCustomerId String?  @unique @map("stripe_customer_id")
```

- [ ] **Step 2: Generate the migration without applying it**

Run: `npx prisma migrate dev --name bidder_identity --create-only`
Expected: new folder `prisma/migrations/<timestamp>_bidder_identity/` with a `CREATE UNIQUE INDEX "bidders_stripe_customer_id_key"` statement.

- [ ] **Step 3: Append the hand-written CHECK** to that `migration.sql`

```sql
-- Hand-written: bidders.email must already be trimmed and lowercased (NormalizedEmail invariant)
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));
```

- [ ] **Step 4: Apply and regenerate client**

Run: `npx prisma migrate dev && npx prisma generate`
Expected: migration applied, no drift.

- [ ] **Step 5: Verify constraints in SQL** (psql against the local DB; adjust connection per `.env.example`)

```sql
INSERT INTO bidders (id, email, updated_at) VALUES ('t1', 'Mixed@Example.com', now());   -- expect: check constraint violation
INSERT INTO bidders (id, email, updated_at) VALUES ('t2', 'ok@example.com', now());      -- expect: ok
UPDATE bidders SET stripe_customer_id = 'cus_x' WHERE id = 't2';                          -- expect: ok
INSERT INTO bidders (id, email, stripe_customer_id, updated_at) VALUES ('t3', 'b@example.com', 'cus_x', now()); -- expect: unique violation
DELETE FROM bidders WHERE id IN ('t2', 't3');
```

- [ ] **Step 6: Stage**

```bash
git add prisma/schema.prisma prisma/migrations
```
Commit message when approved: `feat(bidders): enforce unique stripe customer and normalised email`.

---

### Task 3: BidderDb and BidderService API

**Files:**
- Modify: `src/bidders/bidder.db.ts`
- Modify: `src/bidders/bidder.service.ts`
- Test: `src/bidders/bidder.service.spec.ts`

**Interfaces:**
- Consumes: `normalizeEmail` (Task 1); `BidderId` from `src/common/ids.ts`; `StripeCustomerId` from `src/common/stripe-ids.ts`; Prisma `Bidder` type (Task 2 schema).
- Produces (db): `findById(id: BidderId): Promise<Bidder | null>`; `setStripeCustomerIdIfUnset(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<Bidder | null>` (null only when the bidder does not exist; otherwise the row as it is after the attempt); existing `findByEmail`, `upsertByEmail` unchanged.
- Produces (service): `getOrCreateByEmail(rawEmail: string): Promise<Bidder>` (lets `InvalidValueError('email_invalid')` propagate; the global filter maps it to 400); `getById(id: BidderId): Promise<Bidder>` (throws `NotFoundException('bidder_not_found')`); `attachStripeCustomer(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<Bidder>` (throws `NotFoundException('bidder_not_found')`, `ConflictException('bidder_stripe_customer_conflict')`). `findByEmail` is deliberately not exposed on the service.

- [ ] **Step 1: Write failing tests.** Replace `src/bidders/bidder.service.spec.ts` with:

```ts
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { vi } from 'vitest';
import { InvalidValueError } from '../common/domain-error.js';
import type { BidderId } from '../common/ids.js';
import type { StripeCustomerId } from '../common/stripe-ids.js';
import { BidderService } from './bidder.service.js';
import { BidderDb } from './bidder.db.js';

describe('BidderService', () => {
  const bidderId = 'bidder-1' as BidderId;
  const customerId = 'cus_123' as StripeCustomerId;
  let db: DeepMockProxy<BidderDb>;
  let service: BidderService;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = mockDeep<BidderDb>();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [BidderService, { provide: BidderDb, useValue: db }],
    }).compile();
    service = moduleRef.get(BidderService);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('getOrCreateByEmail', () => {
    describe('when the email is already normalised', () => {
      const bidder = { id: 'bidder-1', email: 'brand@example.com' };

      beforeEach(() => {
        db.upsertByEmail.mockResolvedValue(bidder as never);
      });

      it('upserts it unchanged and returns the bidder', async () => {
        const result = await service.getOrCreateByEmail('brand@example.com');

        expect(db.upsertByEmail).toHaveBeenCalledWith('brand@example.com');
        expect(result).toEqual(bidder);
      });
    });

    describe('when the email has mixed case and surrounding whitespace', () => {
      beforeEach(() => {
        db.upsertByEmail.mockResolvedValue({} as never);
      });

      it('upserts the trimmed lowercase email', async () => {
        await service.getOrCreateByEmail('  Jamie@Example.COM ');

        expect(db.upsertByEmail).toHaveBeenCalledWith('jamie@example.com');
      });
    });

    describe('when the email is invalid', () => {
      it('throws email_invalid and never touches the db', async () => {
        await expect(service.getOrCreateByEmail('not-an-email')).rejects.toThrow(InvalidValueError);
        await expect(service.getOrCreateByEmail('not-an-email')).rejects.toThrow('email_invalid');

        expect(db.upsertByEmail).not.toHaveBeenCalled();
      });

      it('logs a warning without the raw email', async () => {
        await service.getOrCreateByEmail('not-an-email').catch(() => undefined);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).not.toContain('not-an-email');
      });
    });
  });

  describe('getById', () => {
    describe('when the bidder exists', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId } as never);
      });

      it('returns it', async () => {
        await expect(service.getById(bidderId)).resolves.toEqual({ id: bidderId });
      });
    });

    describe('when the bidder does not exist', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue(null);
      });

      it('throws bidder_not_found and logs the id', async () => {
        await expect(service.getById(bidderId)).rejects.toThrow(new NotFoundException('bidder_not_found'));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(bidderId));
      });
    });
  });

  describe('attachStripeCustomer', () => {
    describe('when the bidder does not exist', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue(null);
      });

      it('throws bidder_not_found', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new NotFoundException('bidder_not_found'),
        );

        expect(db.setStripeCustomerIdIfUnset).not.toHaveBeenCalled();
      });
    });

    describe('when the bidder has no Stripe customer yet', () => {
      const attached = { id: bidderId, stripeCustomerId: customerId };

      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: null } as never);
        db.setStripeCustomerIdIfUnset.mockResolvedValue(attached as never);
      });

      it('stores it and returns the updated bidder', async () => {
        const result = await service.attachStripeCustomer(bidderId, customerId);

        expect(db.setStripeCustomerIdIfUnset).toHaveBeenCalledWith(bidderId, customerId);
        expect(result).toEqual(attached);
      });
    });

    describe('when the bidder already has the same Stripe customer', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: customerId } as never);
      });

      it('returns it unchanged without writing', async () => {
        const result = await service.attachStripeCustomer(bidderId, customerId);

        expect(result).toEqual({ id: bidderId, stripeCustomerId: customerId });
        expect(db.setStripeCustomerIdIfUnset).not.toHaveBeenCalled();
      });
    });

    describe('when the bidder already has a different Stripe customer', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: 'cus_other' } as never);
      });

      it('throws bidder_stripe_customer_conflict and logs the ids', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new ConflictException('bidder_stripe_customer_conflict'),
        );

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(bidderId));
        expect(db.setStripeCustomerIdIfUnset).not.toHaveBeenCalled();
      });
    });

    describe('when another request attaches a different customer first', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: null } as never);
        db.setStripeCustomerIdIfUnset.mockResolvedValue({ id: bidderId, stripeCustomerId: 'cus_other' } as never);
      });

      it('throws bidder_stripe_customer_conflict', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new ConflictException('bidder_stripe_customer_conflict'),
        );
      });
    });

    describe('when the bidder is deleted between the read and the write', () => {
      beforeEach(() => {
        db.findById.mockResolvedValue({ id: bidderId, stripeCustomerId: null } as never);
        db.setStripeCustomerIdIfUnset.mockResolvedValue(null);
      });

      it('throws bidder_not_found', async () => {
        await expect(service.attachStripeCustomer(bidderId, customerId)).rejects.toThrow(
          new NotFoundException('bidder_not_found'),
        );
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/bidders`
Expected: FAIL (`findById` / `getById` / `attachStripeCustomer` not defined; invalid-email case not mapped).

- [ ] **Step 3: Implement `src/bidders/bidder.db.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type { NormalizedEmail } from '../common/email.js';
import type { BidderId } from '../common/ids.js';
import type { StripeCustomerId } from '../common/stripe-ids.js';
import { Bidder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BidderDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: BidderId): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { id } });
  }

  findByEmail(email: NormalizedEmail): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { email } });
  }

  upsertByEmail(email: NormalizedEmail): Promise<Bidder> {
    return this.prisma.bidder.upsert({
      where: { email },
      create: { email },
      update: {},
    });
  }

  async setStripeCustomerIdIfUnset(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<Bidder | null> {
    await this.prisma.bidder.updateMany({
      where: { id, stripeCustomerId: null },
      data: { stripeCustomerId },
    });

    return this.prisma.bidder.findUnique({ where: { id } });
  }
}
```

Keep `upsertByEmail` exactly in this shape (single unique `where`, same field in `create`, empty `update`) so Prisma emits a native `ON CONFLICT` and concurrent first bids do not raise P2002.

- [ ] **Step 4: Implement `src/bidders/bidder.service.ts`**

```ts
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { normalizeEmail } from '../common/email.js';
import type { BidderId } from '../common/ids.js';
import type { StripeCustomerId } from '../common/stripe-ids.js';
import { BidderDb } from './bidder.db.js';

type BidderRecord = Awaited<ReturnType<BidderDb['upsertByEmail']>>;

@Injectable()
export class BidderService {
  private readonly logger = new Logger(BidderService.name);

  constructor(private readonly db: BidderDb) {}

  getOrCreateByEmail(rawEmail: string): Promise<BidderRecord> {
    return this.db.upsertByEmail(normalizeEmail(rawEmail));
  }

  async getById(id: BidderId): Promise<BidderRecord> {
    const bidder = await this.db.findById(id);

    if (!bidder) {
      this.logger.warn(`Bidder ${id} not found`);

      throw new NotFoundException('bidder_not_found');
    }

    return bidder;
  }

  async attachStripeCustomer(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<BidderRecord> {
    const bidder = await this.getById(id);

    if (bidder.stripeCustomerId === stripeCustomerId) {
      return bidder;
    }

    if (bidder.stripeCustomerId != null) {
      this.throwStripeConflict(id, bidder.stripeCustomerId, stripeCustomerId);
    }

    const updated = await this.db.setStripeCustomerIdIfUnset(id, stripeCustomerId);

    if (!updated) {
      this.logger.warn(`Bidder ${id} not found`);

      throw new NotFoundException('bidder_not_found');
    }

    if (updated.stripeCustomerId !== stripeCustomerId) {
      this.throwStripeConflict(id, updated.stripeCustomerId, stripeCustomerId);
    }

    return updated;
  }

  private throwStripeConflict(id: BidderId, existing: string | null, requested: StripeCustomerId): never {
    this.logger.warn(`Bidder ${id} already linked to Stripe customer ${existing}, refused ${requested}`);

    throw new ConflictException('bidder_stripe_customer_conflict');
  }
}
```

- [ ] **Step 5: Run to verify pass, then the full gate**

Run: `npx vitest run src/bidders && npm test && npm run lint && npm run lint:arch && npm run build`
Expected: all PASS, no lint or architecture violations.

- [ ] **Step 6: Stage**

```bash
git add src/bidders
```
Commit message when approved: `feat(bidders): add get-by-id and stripe customer linking`.

---

## Self-Review

- Spec coverage: Q9/Q10 (Tasks 1, 2), Q7 (Tasks 2, 3), Q4/Q5/Q6/Q8/Q11 are deliberate no-ops (no task), error codes (Task 3), Q3 (service omits `findByEmail`), testing section (Tasks 1-3, SQL checks in Task 2).
- Types: `BidderRecord`, `BidderId`, `StripeCustomerId`, `NormalizedEmail` consistent across Task 3 db, service and spec.
- No placeholders.
