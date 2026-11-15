# HYR-59 Bidder Payment Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add card-summary columns to `bidders`, a signed bidder token, and `POST /bidders/setup-intents` that find-or-creates the bidder, lazily creates the Stripe customer, creates a setup intent, and returns client secret + token; a bidder with a saved card must present a valid token.

**Architecture:** `BidderTokenModule` / `BidderTokenService` (JWT HS256 via `@nestjs/jwt`, own secret). A usecase `CreatePaymentSetupUsecase` + `CreatePaymentSetupUsecaseDb` in `src/bidders/usecases/create-payment-setup/` (user decision, per CLAUDE.md). Call direction controller -> `BidderService.createPaymentSetup` (thin delegate) -> usecase -> usecase db; the usecase never calls `BidderService` (it uses `normalizeEmail`, `bidderId`, `stripeCustomerId` constructors and re-implements the race-safe attach in its own db). No interim shortcut: `BidderDb` and `BidderService.attachStripeCustomer` stay untouched, the usecase db is a full physical copy of the two queries it needs (flagged as follow-up: delete `attachStripeCustomer` if it ends up caller-less). No ORM import in services or usecases.

**Decisions applied:** Q2 (`BIDDER_JWT_SECRET`) and Q3 (24 h TTL) approved; Q13 overruled to usecase layer; split made vertical.

**Tech Stack:** NestJS 12, Prisma 6, Vitest 5, `@nestjs/jwt` 12.0.2 and `@nestjs/throttler` 6.7.1 (already pinned, no new deps).

**Spec:** `docs/specs/2026-11-15-hyr-59-bidder-payment-setup-design.md`

## Ticket split (PR budget)

Total about 1_150 lines with tests, over the ~800 cap. One layer (backend), one actor (public guest). Two stacked PRs, vertical (no dead schema):

| PR | Tasks | Est. lines | Depends on |
|---|---|---|---|
| A: bidder token | 1-4 | ~360 | hyr-58 base |
| B: setup endpoint | 5-11 | ~790 | A |

PR A is standalone and reusable by HYR-11. PR B is the whole visible slice (migration, usecase, endpoint) because the columns are consumed by the usecase gate.

PR B sits at the cap. Pre-marked cut line after Task 9 (usecase + delegate + int spec, ~480): Tasks 10-11 (controller, DTO, throttle spec, README, ~310) become PR C if the real diff exceeds 800. A 3-way split is the fallback, not the default, because the middle PR would have no HTTP caller. Docs (spec + plan) in a separate `docs` commit. Sequential, no parallelism.

## Global Constraints

- Backend-only; no web, no webhook, no bid enforcement (HYR-11), no writes to the card columns (HYR-60).
- No new deps. Any dep added must be pinned exactly.
- Explicit return types everywhere; `readonly` constructor params; no single-letter names (except `i` in indexed loops); braces on every `if`, blank line before `if`/`for`/`return`/`throw` unless first in block; numeric separators for 5+ digit literals; no barrels; comments only for a non-obvious why.
- Error codes snake_case, human detail via `Logger` at the throw site (`warn`), never log tokens or client secrets. `src/common` helpers throw codes only, never log.
- Services and usecases import no Prisma; only `*.usecase.db.ts` does. Brand casts only in `*.db.ts` / adapter; services use validating constructors (`bidderId()`, `stripeCustomerId()`, `normalizeEmail()`).
- Tests: Vitest, nested `describe('when ...')`, short `it` titles (outcome only).
- Commits: conventional commits, lowercase imperative, end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage and stop for the user's `/crit` before the final commit; local intermediate commits only if needed.
- Verify per task as stated; final `npm run verify` and `npm run test:integration` (needs Postgres on 5435; if held by another workspace use a throwaway container on another port via `TEST_ADMIN_DATABASE_URL`).

## File Structure

PR A:
- Modify `src/config/env.validation.ts`, `src/config/env.validation.spec.ts`, `.env.example`.
- Create `src/common/bidder-token.ts`, `src/common/bidder-token.spec.ts`.
- Create `src/bidders/bidder-token.config.ts`, `bidder-token.service.ts`, `bidder-token.service.spec.ts`, `bidder-token.module.ts`.
- Modify `src/bidders/bidders.module.ts` (import + re-export `BidderTokenModule`).
- Create `src/bidders/bidder-token-isolation.spec.ts`.

PR B:
- Modify `prisma/schema.prisma`; create `prisma/migrations/20261115090000_add_bidder_payment_method/migration.sql`.
- Create `src/bidders/usecases/create-payment-setup/create-payment-setup.usecase.db.ts` + `.spec.ts`, `create-payment-setup.usecase.ts` + `.spec.ts`, `create-payment-setup.module.ts`, `create-payment-setup.usecase.int.spec.ts`.
- Modify `src/bidders/bidder.service.ts` + `.spec.ts` (delegate `createPaymentSetup`), `src/bidders/bidders.module.ts` (import usecase module and `StripeModule` not needed here; the usecase module imports `StripeModule` and `BidderTokenModule`).
- Create `src/bidders/dto/create-setup-intent.dto.ts`, `setup-intent-response.ts` (+ spec), `bidder.controller.ts` + `bidder.controller.spec.ts`; modify `README.md`.

---

## PR A

### Task 1: Env vars

**Files:** `src/config/env.validation.ts`, `.spec.ts`, `.env.example`.

- [ ] **Step 1 (failing tests)** in `env.validation.spec.ts`: add `BIDDER_JWT_SECRET: 'b'.repeat(32)` to `validEnv`, then describes: `when BIDDER_JWT_SECRET is missing` / `is shorter than 32` -> throws `env_invalid`; `when BIDDER_JWT_SECRET equals JWT_SECRET` and `equals STAFF_JWT_SECRET` -> throws `env_invalid` and logs `bidder_jwt_secret_must_differ`; `when BIDDER_TOKEN_TTL_SECONDS is unset` -> `86_400`; `is 0` -> `env_invalid`.
- [ ] **Step 2:** Run `npx vitest run src/config/env.validation.spec.ts`, expect FAIL.
- [ ] **Step 3:** In `env.validation.ts` add `const DEFAULT_BIDDER_TOKEN_TTL_SECONDS = 86_400;`, fields:

```ts
  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  BIDDER_JWT_SECRET!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  BIDDER_TOKEN_TTL_SECONDS: number = DEFAULT_BIDDER_TOKEN_TTL_SECONDS;
```

and in `validateEnv` after the staff check:

```ts
  if (env.BIDDER_JWT_SECRET === env.JWT_SECRET || env.BIDDER_JWT_SECRET === env.STAFF_JWT_SECRET) {
    new Logger('Env').error('bidder_jwt_secret_must_differ');

    throw new Error('env_invalid');
  }
```

- [ ] **Step 4:** `.env.example` add `BIDDER_JWT_SECRET=local-dev-only-bidder-jwt-secret-0123456789` and `BIDDER_TOKEN_TTL_SECONDS=86400` under the staff block. Fix any other spec/fixture that builds a full env (grep `STAFF_JWT_SECRET` in `src`; `app` e2e/int bootstraps).
- [ ] **Step 5:** `npx vitest run src/config` PASS; `npm run typecheck`. Commit `feat(config): add bidder token secret and ttl`.

### Task 2: `BidderToken` brand

**Files:** `src/common/bidder-token.ts`, `src/common/bidder-token.spec.ts`.

- [ ] **Step 1 (failing spec)**: describes `when the value is a three-segment base64url token` -> returns it trimmed; `when empty/whitespace`, `has two segments`, `has a space`, `is longer than 2048` -> throws `InvalidValueError('bidder_token_invalid')`.
- [ ] **Step 2:** Implement:

```ts
import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';

export type BidderToken = Brand<string, 'BidderToken'>;

const BIDDER_TOKEN_MAX_LENGTH = 2048;
const BIDDER_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function bidderToken(value: string): BidderToken {
  const trimmed = value.trim();

  if (trimmed.length > BIDDER_TOKEN_MAX_LENGTH || !BIDDER_TOKEN_PATTERN.test(trimmed)) {
    throw new InvalidValueError('bidder_token_invalid');
  }

  return trimmed as BidderToken;
}
```

- [ ] **Step 3:** `npx vitest run src/common/bidder-token.spec.ts` PASS. Commit `feat(common): add bidder token brand`.

### Task 3: `BidderTokenService`

**Files:** `src/bidders/bidder-token.config.ts`, `bidder-token.service.ts`, `bidder-token.service.spec.ts`, `bidder-token.module.ts`, `bidders.module.ts`.

**Interfaces:**
- `BidderTokenConfig { readonly ttlSeconds: number }` (reads `BIDDER_TOKEN_TTL_SECONDS`, like `StaffAuthConfig`).
- `BidderTokenService.issue(id: BidderId, tokenVersion: number): Promise<{ token: BidderToken; expiresAt: Date }>` (claim `ver`)
- `BidderTokenService.verify(raw: string | undefined): Promise<{ bidderId: BidderId; tokenVersion: number }>`; rejects a missing, non-integer or negative `ver`; throws `UnauthorizedException('bidder_token_required')`.

- [ ] **Step 1 (failing spec)**, constructing `new BidderTokenService(new JwtService({ secret }), { ttlSeconds: 900 })`, `Logger.prototype.warn` spied. Describes:
  - `when issuing a token` -> verify round trip returns the same id; `expiresAt` is about now + ttl (fake timers).
  - `when the token has expired` (advance fake timers past ttl) -> rejects `bidder_token_required`.
  - `when the token is signed with another secret` / `has another audience` / `has no subject` / `is garbage` / `is undefined` / `is empty` -> rejects `bidder_token_required`.
  - `when verification fails` -> warn logged, log text does not contain the token.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement (mirror `staff-token.service.ts`):

```ts
const BIDDER_AUDIENCE = 'hyrox-bidder';
const TOKEN_ISSUER = 'hyrox-api';
const MILLIS_PER_SECOND = 1000;

export type IssuedBidderToken = { token: BidderToken; expiresAt: Date };

@Injectable()
export class BidderTokenService {
  private readonly logger = new Logger(BidderTokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: BidderTokenConfig,
  ) {}

  async issue(id: BidderId): Promise<IssuedBidderToken> {
    const signed = await this.jwt.signAsync(
      { sub: id },
      { algorithm: 'HS256', expiresIn: this.config.ttlSeconds, audience: BIDDER_AUDIENCE, issuer: TOKEN_ISSUER },
    );

    return {
      token: bidderToken(signed),
      expiresAt: new Date(Date.now() + this.config.ttlSeconds * MILLIS_PER_SECOND),
    };
  }

  async verify(raw: string | undefined): Promise<BidderId> {
    try {
      if (raw === undefined || raw.trim() === '') {
        throw new Error('missing token');
      }

      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(raw.trim(), {
        algorithms: ['HS256'],
        audience: BIDDER_AUDIENCE,
        issuer: TOKEN_ISSUER,
      });

      if (typeof payload.sub !== 'string') {
        throw new Error('missing subject');
      }

      return bidderId(payload.sub);
    } catch (error) {
      this.logger.warn(`Bidder token rejected: ${error instanceof Error ? error.message : String(error)}`);

      throw new UnauthorizedException('bidder_token_required');
    }
  }
}
```

  Check that jsonwebtoken error messages never embed the token (they do not); the spec asserts it.
- [ ] **Step 4:** Create `bidder-token.module.ts`: `imports: [JwtModule.registerAsync({ inject: [ConfigService], useFactory: (config: ConfigService<EnvironmentVariables, true>): { secret: string } => ({ secret: config.get('BIDDER_JWT_SECRET', { infer: true }) }) })]`, providers `BidderTokenConfig`, `BidderTokenService`, exports `BidderTokenService`. Separate module so the usecase module and HYR-11 import it without a cycle with `BiddersModule`. In `bidders.module.ts` add `BidderTokenModule` to `imports` and `exports`.
- [ ] **Step 5:** `npx vitest run src/bidders src/common` PASS; `npm run typecheck`; `npm run lint`. Commit `feat(bidders): add signed bidder token service`.

### Task 4: Token isolation

**Files:** `src/bidders/bidder-token-isolation.spec.ts` (new, pattern of `src/staff-auth/token-isolation.spec.ts`).

- [ ] **Step 1:** Spec with three real token services (athlete `TokenService`, staff `StaffTokenService`, `BidderTokenService`), distinct secrets. Describes: `when a bidder token is presented to the athlete guard` -> `JwtAuthGuard` throws `invalid_token`; `... to the staff guard` -> `StaffGuard` rejects; `when an athlete token is presented to BidderTokenService.verify` and `when a staff token is` -> `bidder_token_required`.
- [ ] **Step 2:** `npx vitest run src/bidders/bidder-token-isolation.spec.ts` PASS (no production change expected; if it fails, fix the claim/secret wiring). Run `npm run verify:fast`. Commit `test(bidders): cover token isolation between athlete, staff and bidder`.

**PR A ends here. Deploy note:** every environment needs `BIDDER_JWT_SECRET` before this PR is deployed (app refuses to boot otherwise).

---

## PR B

### Task 5: Columns and migration

**Files:** `prisma/schema.prisma`, new migration dir.

- [ ] **Step 1:** In `model Bidder` add after `stripeCustomerId`:

```prisma
  tokenVersion           Int     @default(0) @map("token_version")
  defaultPaymentMethodId String? @map("default_payment_method_id")
  cardBrand              String? @map("card_brand")
  cardLast4              String? @map("card_last4")
```

- [ ] **Step 2:** Generate SQL with the shadow-database procedure in `README.md` ("Hand-written SQL and `prisma migrate dev`", `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --script`; never `migrate dev`, it is not non-interactive). Write `migration.sql`:

```sql
-- AlterTable
ALTER TABLE "bidders" ADD COLUMN "card_brand" TEXT,
ADD COLUMN "card_last4" TEXT,
ADD COLUMN "default_payment_method_id" TEXT;

-- Hand-written: a card is stored whole or not at all (HYR-60 writes it in one update).
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_card_all_or_none_check" CHECK (
  ("default_payment_method_id" IS NULL AND "card_brand" IS NULL AND "card_last4" IS NULL)
  OR ("default_payment_method_id" IS NOT NULL AND "card_brand" IS NOT NULL AND "card_last4" ~ '^[0-9]{4}$')
);
```

- [ ] **Step 3:** Apply to local DB (`npx prisma migrate deploy`), `npx prisma generate`, then drift check: diff migrations to schema against a fresh shadow DB, expect `-- This is an empty migration.`; drop the shadow DB.
- [ ] **Step 4:** Sanity SQL (psql): half-written row (`card_brand` only) fails the CHECK; all three valid passes; `card_last4 = '12a4'` fails. Rollback test rows. (Permanent coverage is the int spec in Task 9.)
- [ ] **Step 5:** `npm run typecheck`. Commit `feat(bidders): add payment method columns`.

> **Amendment (security review, Q15):** `bidders.token_version INTEGER NOT NULL DEFAULT 0` is added in the same migration; tokens carry `ver`; the usecase requires `token.bidderId === bidder.id && token.tokenVersion === bidder.tokenVersion` when a card exists, re-reads the row (`findById` on the usecase db) right before issuing, and issues with the current `tokenVersion`. HYR-60 MUST set the three card columns and increment `token_version` in one atomic UPDATE; HYR-11 compares `verify().tokenVersion` with the row. PR B grows past the 800-line cap with this (about 890 changed lines excluding docs); controller/DTO/README stay in PR C.

### Task 6: Usecase db

**Files:** `src/bidders/usecases/create-payment-setup/create-payment-setup.usecase.db.ts`, `.spec.ts` (pattern of `place-bid.usecase.db.spec.ts`).

**Interfaces:**
- `upsertByEmail(email: NormalizedEmail): Promise<Bidder>`: `prisma.bidder.upsert({ where: { email }, create: { email }, update: {} })` (single-unique-field shape so Prisma emits `ON CONFLICT`).
- `setStripeCustomerIdIfUnset(id: BidderId, customerId: StripeCustomerId): Promise<Bidder | null>`: `updateMany({ where: { id, stripeCustomerId: null }, data: { stripeCustomerId } })` then `findUnique({ where: { id } })`.
- Only Prisma importer in the folder; no domain throws; `constructor(private readonly prisma: PrismaService)`.

- [ ] **Step 1 (failing spec)** with `mockDeep<PrismaService>()`: describes for each method asserting the exact query shapes above and returned rows (`null` when the re-read finds nothing).
- [ ] **Step 2:** Run `npx vitest run src/bidders/usecases`, expect FAIL. Implement. PASS.
- [ ] **Step 3:** typecheck, lint, `npm run lint:arch`. Commit `feat(bidders): add create payment setup usecase db`.

### Task 7: `CreatePaymentSetupUsecase`

**Files:** `create-payment-setup.usecase.ts`, `create-payment-setup.usecase.spec.ts`.

**Interfaces:**

```ts
export type CreatePaymentSetupInput = { email: string; bidderToken: string | undefined };
export type CreatePaymentSetupResult = { clientSecret: string; bidderToken: BidderToken; bidderTokenExpiresAt: Date };
execute(input: CreatePaymentSetupInput): Promise<CreatePaymentSetupResult>
```

Depends on `CreatePaymentSetupUsecaseDb`, `StripeGateway`, `BidderTokenService`. Never imports `BidderService`.

- [ ] **Step 1 (failing spec)**, `mockDeep` for the three deps, `Logger.prototype.warn` spied. Fixture row `{ id: 'bidder-1', email: 'jamie@x.com', stripeCustomerId: null, defaultPaymentMethodId: null }`. Describes:
  - `when the email is invalid` -> rejects `email_invalid`, db untouched.
  - `when the email has mixed case` -> db upsert gets the normalised email.
  - `when the bidder has no card and no Stripe customer` -> `createCustomer({ bidderId, email })`, `setStripeCustomerIdIfUnset(id, customerId)`, `createSetupIntent(customerId)`, `issue(id)`; returns secret + token + expiry; `verify` never called.
  - `when the bidder has no card but already has a Stripe customer` -> `createCustomer` and the db write not called; setup intent uses that customer.
  - `when the bidder has a card`:
    - `and no token is sent` -> `bidder_token_required`; gateway and `issue` never called.
    - `and the token is valid for this bidder` -> succeeds, issues a fresh token.
    - `and the token belongs to another bidder` -> `bidder_token_required`, warn logs both ids.
    - `and verify rejects (expired)` -> propagates, gateway never called.
  - `when the customer write returns null` -> `NotFoundException('bidder_not_found')`, warn with id, no setup intent.
  - `when the stored customer is a different Stripe id` (concurrent writer) -> `ConflictException('bidder_stripe_customer_conflict')`, warn, no setup intent, no token.
  - `when the stored customer equals the created id` (concurrent same id) -> proceeds.
  - `when Stripe fails creating the setup intent` -> error propagates, no token issued.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement:

```ts
@Injectable()
export class CreatePaymentSetupUsecase {
  private readonly logger = new Logger(CreatePaymentSetupUsecase.name);

  constructor(
    private readonly db: CreatePaymentSetupUsecaseDb,
    private readonly stripe: StripeGateway,
    private readonly tokens: BidderTokenService,
  ) {}

  async execute(input: CreatePaymentSetupInput): Promise<CreatePaymentSetupResult> {
    const bidder = await this.db.upsertByEmail(normalizeEmail(input.email));
    const id = bidderId(bidder.id);

    if (bidder.defaultPaymentMethodId != null) {
      await this.requireOwnership(id, input.bidderToken);
    }

    const customerId = await this.ensureCustomer(id, bidder);
    const setupIntent = await this.stripe.createSetupIntent(customerId);
    const issued = await this.tokens.issue(id);

    return { clientSecret: setupIntent.clientSecret, bidderToken: issued.token, bidderTokenExpiresAt: issued.expiresAt };
  }

  private async requireOwnership(id: BidderId, rawToken: string | undefined): Promise<void> {
    const tokenBidderId = await this.tokens.verify(rawToken);

    if (tokenBidderId !== id) {
      this.logger.warn(`Bidder token for ${tokenBidderId} presented for bidder ${id}`);

      throw new UnauthorizedException('bidder_token_required');
    }
  }

  private async ensureCustomer(id: BidderId, bidder: Bidder): Promise<StripeCustomerId> {
    if (bidder.stripeCustomerId != null) {
      return stripeCustomerId(bidder.stripeCustomerId);
    }

    const created = await this.stripe.createCustomer({ bidderId: id, email: normalizeEmail(bidder.email) });
    const stored = await this.db.setStripeCustomerIdIfUnset(id, created);

    if (stored === null) {
      this.logger.warn(`Bidder ${id} disappeared while attaching Stripe customer ${created}`);

      throw new NotFoundException('bidder_not_found');
    }

    if (stored.stripeCustomerId !== created) {
      this.logger.warn(`Bidder ${id} already has Stripe customer ${stored.stripeCustomerId}, not ${created}`);

      throw new ConflictException('bidder_stripe_customer_conflict');
    }

    return created;
  }
}
```

  The `Bidder` type for the row comes from `Awaited<ReturnType<CreatePaymentSetupUsecaseDb['upsertByEmail']>>` (no `@prisma/client` import in the usecase file; `lint:arch` forbids it).
- [ ] **Step 4:** `npx vitest run src/bidders` PASS; typecheck; lint; `lint:arch`. Commit `feat(bidders): add create payment setup usecase`.

### Task 8: Usecase module and `BidderService` delegate

**Files:** `create-payment-setup.module.ts`, `src/bidders/bidder.service.ts` + `.spec.ts`, `src/bidders/bidders.module.ts`.

- [ ] **Step 1 (failing test)** in `bidder.service.spec.ts`: add `{ provide: CreatePaymentSetupUsecase, useValue: usecase }` to the testing module; describe `createPaymentSetup` / `when called` -> returns the usecase `execute` result for the same input.
- [ ] **Step 2:** Run, expect FAIL. Implement: `create-payment-setup.module.ts` (`imports: [StripeModule, BidderTokenModule]`, `providers: [CreatePaymentSetupUsecase, CreatePaymentSetupUsecaseDb]`, `exports: [CreatePaymentSetupUsecase]`, same shape as `PlaceBidModule`). `BidderService` gets `private readonly createPaymentSetupUsecase: CreatePaymentSetupUsecase` and

```ts
  createPaymentSetup(input: CreatePaymentSetupInput): Promise<CreatePaymentSetupResult> {
    return this.createPaymentSetupUsecase.execute(input);
  }
```

  `BiddersModule` imports `CreatePaymentSetupModule`. Existing `BidderService` consumers' specs that build the real service (grep `BidderService` in specs) need the extra provider or a mock.
- [ ] **Step 3:** `npx vitest run src/bidders src/bids` PASS; typecheck; lint; `lint:arch` (confirm `bidders -> stripe` is allowed). Commit `feat(bidders): delegate payment setup to usecase`.

### Task 9: Integration test

**Files:** `src/bidders/usecases/create-payment-setup/create-payment-setup.usecase.int.spec.ts` (pattern of `place-bid.usecase.int.spec.ts`: `createThrowawayDatabase`, `isPostgresReachable`, `requireReachableInCi`, `describe.skipIf(!reachable)`).

Wiring: real `CreatePaymentSetupUsecaseDb(prisma)`, `BidderTokenService(new JwtService({ secret }), { ttlSeconds: 900 })`, `CreatePaymentSetupUsecase`; fake gateway cast `as unknown as StripeGateway`, `createCustomer` returns a deterministic `cus_<bidderId>` (mimics the idempotency key) and counts calls, `createSetupIntent` returns `{ id: 'seti_1', clientSecret: 'seti_1_secret_x' }`.

- [ ] **Step 1:** Cases, each in a `describe('when ...')`:
  - `a new email` -> bidder row with normalised email, `stripeCustomerId` stored, token verifies to the bidder id.
  - `the same email calls again with no card` -> `createCustomer` called once in total.
  - `two first calls run concurrently` (`Promise.all`) -> one bidder row, one stored customer id, both succeed.
  - `the bidder has a card` (all three columns set via `prisma.bidder.update`) -> no token rejects `bidder_token_required` and gateway call counts unchanged; the token from an earlier call accepted; another bidder's token rejected; expired token rejected (service built with `ttlSeconds: 1`, real `sleep(1_200)`).
  - `the card columns are half written` -> `data: { cardBrand: 'visa' }` rejects (CHECK); `cardLast4: '12a4'` with the other two set rejects; all-null and full rows accepted.
- [ ] **Step 2:** `npm run test:integration -- src/bidders` PASS (skips locally if Postgres is unreachable; CI enforces). Commit `test(bidders): cover create payment setup against postgres`.

**Cut line for a possible PR C:** if PR B's real diff exceeds ~800 lines, stop PR B here and move Tasks 10-11 to a PR stacked on it.

### Task 10: DTO, response mapper, controller, module wiring

**Files:** `src/bidders/dto/create-setup-intent.dto.ts`, `src/bidders/setup-intent-response.ts` + spec, `src/bidders/bidder.controller.ts`, `bidder.controller.spec.ts`, `bidders.module.ts`.

- [ ] **Step 1 (failing specs).**
  - `setup-intent-response.spec.ts`: maps result to `{ clientSecret, bidderToken, bidderTokenExpiresAt: '<ISO>' }` and exposes no other key.
  - `bidder.controller.spec.ts`: real Nest app (copy `startApp` shape from `src/bids/bid-throttle.spec.ts`: `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])`, `APP_GUARD ThrottlerGuard`, `DomainErrorFilter`, `createValidationPipe`, `applyTrustProxy`, `BidderService` mocked with `{ createPaymentSetup: vi.fn() }`). Describes:
    - `when the request is valid` -> 201, body shape, `Cache-Control: no-store`, service called with the email and the `X-Bidder-Token` header value (undefined when absent).
    - `when the body has an unknown field` (for example `bidderId`) -> 400 `validation_failed`, service not called.
    - `when the email is not an email` -> 400 `validation_failed`.
    - `when createPaymentSetup rejects with bidder_token_required` -> 401 body `message: 'bidder_token_required'`.
    - `when one client sends eleven requests in a minute` -> first ten 201, eleventh 429; `when two clients behind one trusted hop each send ten` -> all 201 (same pair as the bid throttle spec).
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement:

```ts
// dto/create-setup-intent.dto.ts
export class CreateSetupIntentDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}

// bidder.controller.ts
const SETUP_INTENT_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('bidders')
export class BidderController {
  constructor(private readonly bidders: BidderService) {}

  @Post('setup-intents')
  @Throttle(SETUP_INTENT_LIMIT)
  @Header('Cache-Control', 'no-store')
  async createSetupIntent(
    @Body() body: CreateSetupIntentDto,
    @Headers('x-bidder-token') bidderToken: string | undefined,
  ): Promise<SetupIntentResponse> {
    return toSetupIntentResponse(await this.bidders.createPaymentSetup({ email: body.email, bidderToken }));
  }
}
```

  Module: add `controllers: [BidderController]` to `BiddersModule`. Run `npm run lint:arch`; if a rule forbids `bidders -> stripe`, report rather than loosening it silently.
- [ ] **Step 4:** `npx vitest run src/bidders` PASS; typecheck; lint; `npm run lint:arch`. Commit `feat(bidders): add setup-intent endpoint`.

### Task 11: README and final verification

**Files:** `README.md`.

- [ ] **Step 1:** Add section "Bidder payment setup (HYR-59)" after "Bidding (HYR-40)": route `POST /bidders/setup-intents`, public; body `{ "email": string }`; header `X-Bidder-Token` (required only when the email already has a saved card); `201 { clientSecret, bidderToken, bidderTokenExpiresAt }`, `Cache-Control: no-store`; error table from the spec (4.7); throttle 10/min per IP, same caveats as bids; env `BIDDER_JWT_SECRET` (required, min 32, must differ from the other two secrets) and `BIDDER_TOKEN_TTL_SECONDS` (default 86400); the token is not yet enforced on bids (HYR-11); lost token locks the email until HYR-62; known leak: `401 bidder_token_required` reveals the email has a card; spec link.
- [ ] **Step 2:** `npm run verify` PASS and `npm run test:integration` PASS. Stage everything, do not final-commit; tell the user it is staged and they can run `/crit`.

## Self-review notes

- Spec coverage: columns (Task 5), token (1-4), usecase, lazy customer, setup intent (6-8), endpoint (10), token-required rule (7, 9), throttle (10), usecase + usecase db split with no ORM in service/usecase (6-8), int test (9), docs/env (1, 11).
- Branded types: `BidderToken` new; ids via `bidderId()` / `stripeCustomerId()` / `normalizeEmail()` constructors, no casts in services.
- Ticket boundaries: no bid enforcement, no webhook, no card-column writes.
