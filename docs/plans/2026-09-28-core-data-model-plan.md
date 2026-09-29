# HYR-2: Core Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the NestJS + Prisma + PostgreSQL project from scratch and implement the full core data model (athletes, races, zones, auctions, bids, escrow transactions, proofs, disputes, trust/strikes) plus minimal per-module `*.db.ts`/`*.service.ts` scaffolding, so HYR-3 through HYR-8 have a stable schema to build on.

**Architecture:** A single NestJS v12 app built as native ESM (`"type": "module"`, `module`/`moduleResolution`: `NodeNext`, every relative import carries an explicit `.js` extension per Node ESM rules), Prisma as the only ORM (one `PrismaService` shared via a global `PrismaModule`), one feature module per aggregate root. Each module has exactly a `*.db.ts` (only file importing `@prisma/client`) and a `*.service.ts` (business-logic-free reads for this ticket — real business logic arrives in later tickets). `dependency-cruiser` enforces the split in CI/local lint. No controllers, no auth, no Stripe calls, no bid-placement or scheduling logic in this ticket.

**Tech Stack:** Node 24, NestJS v12 (ESM), TypeScript (`module`/`moduleResolution`: `NodeNext`), Prisma, PostgreSQL 16 (local via docker-compose), Vitest, dependency-cruiser, ESLint (with `@typescript-eslint/explicit-function-return-type` set to `error` per CLAUDE.md).

**Spec:** `docs/specs/2026-09-28-core-data-model-design.md`

## Global Constraints

- Every dependency in `package.json` pinned to an exact version (no `^`/`~`) — install unpinned, then rewrite from the resolved version in `package-lock.json`, per CLAUDE.md.
- Every backend function/method has an explicit return type (`@typescript-eslint/explicit-function-return-type: error`).
- No single-letter variable names except `for (let i = ...)` loop counters. No `.catch((e) => ...)` — use `.catch((error) => ...)`.
- No inline `if` — always braced, body on its own line. Blank line before `if`/`for`/`while`/`return`/`throw` unless first statement in the block.
- Constructor-injected dependencies are `private readonly`.
- Money is always `Int` cents in Prisma — never floats.
- Postgres tables/columns are snake_case: every model has `@@map("plural_snake_case")` and every field whose name differs in casing has `@map("snake_case")`. Prisma model/field names stay camelCase in code. Raw-SQL migration fragments and raw-SQL fixtures reference the mapped snake_case names, never the Prisma names.
- Every `DateTime` column is `@db.Timestamptz(3)` (Postgres `timestamp with time zone`); never bare `timestamp`. The one exception is `RaceEntry.raceLocalDate`, which is `@db.Date`.
- Every Prisma `enum` has `@@map("snake_case_name")` (e.g. `BodyZone` -> `body_zone`); raw SQL that casts to or references an enum type uses the mapped name.
- `*.service.ts` files must not import Prisma enums; where a service compares an enum-valued field, it declares a local string-literal union type instead.
- Project is native ESM: `package.json` has `"type": "module"`, `tsconfig.json` uses `module`/`moduleResolution`: `NodeNext`. Every relative import (`./foo`, `../foo`) in source and test files must carry an explicit `.js` extension (Node ESM resolution requirement) — package imports (`@nestjs/common`, `@prisma/client`, `vitest`, etc.) are unaffected.
- NestJS packages pinned to v12 (exact resolved patch version from `package-lock.json`, per the pinning rule above).
- `*.service.ts`/`*.usecase.ts` files must never import `@prisma/client` — only `*.db.ts` files may. Enforced by `dependency-cruiser`.
- Migration history was regenerated as a single `init` migration (from empty) plus the hand-written CHECK constraint and partial unique index appended with `-- Hand-written` comments; per-task `migrate dev` steps below describe how each model was introduced.
- Both `*Service` and `*Db` are registered as providers in their module (CLAUDE.md example shape).
- Delete dead code rather than commenting it out. No comments restating what the code already says.
- Comments only for genuinely non-obvious "why" — most tasks in this plan need none.

---

## File Structure

```
package.json
tsconfig.json
nest-cli.json
eslint.config.mjs
vitest.config.ts
.dependency-cruiser.cjs
docker-compose.yml
.env.example
prisma/
  schema.prisma
  migrations/
src/
  main.ts
  app.module.ts
  prisma/
    prisma.module.ts
    prisma.service.ts
  athletes/
    athlete.db.ts
    athlete.service.ts
    athlete.service.spec.ts
    athletes.module.ts
  bidders/
    bidder.db.ts
    bidder.service.ts
    bidder.service.spec.ts
    bidders.module.ts
  zones/
    zone-floor-price.db.ts
    zone-floor-price.service.ts
    zone-floor-price.service.spec.ts
    zones.module.ts
  races/
    race.db.ts
    race.service.ts
    race.service.spec.ts
    race-entry.db.ts
    race-entry.service.ts
    race-entry.service.spec.ts
    races.module.ts
  auctions/
    auction.db.ts
    auction.service.ts
    auction.service.spec.ts
    auctions.module.ts
  bids/
    bid.db.ts
    bid.service.ts
    bid.service.spec.ts
    bids.module.ts
  escrow/
    escrow-transaction.db.ts
    escrow-transaction.service.ts
    escrow-transaction.service.spec.ts
    escrow.module.ts
  proofs/
    sponsorship-proof.db.ts
    sponsorship-proof.service.ts
    sponsorship-proof.service.spec.ts
    proofs.module.ts
  disputes/
    dispute.db.ts
    dispute.service.ts
    dispute.service.spec.ts
    disputes.module.ts
  trust/
    strike.db.ts
    trust-score-event.db.ts
    trust.service.ts
    trust.service.spec.ts
    trust.module.ts
```

---

### Task 1: Project scaffold (NestJS v12, ESM TypeScript, lint, test tooling)

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs`, `vitest.config.ts`, `src/main.ts`, `src/app.module.ts`

**Interfaces:**
- Produces: a running `npm run build`, `npm run lint`, `npm test` pipeline that later tasks add to. All later tasks' relative imports must carry an explicit `.js` extension (Node ESM requirement) even though the source files are `.ts` — TypeScript resolves this correctly under `moduleResolution: NodeNext` because it maps to the compiled `.js` output path.

- [ ] **Step 1: Init npm project and install core deps (unpinned first, NestJS pinned to major v12)**

```bash
npm init -y
npm install @nestjs/common@12 @nestjs/core@12 @nestjs/platform-express@12 reflect-metadata rxjs
npm install -D typescript @types/node @types/express @nestjs/cli@12 @nestjs/schematics@12 @nestjs/testing@12 vitest eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

- [ ] **Step 2: Pin every dependency to its resolved version and mark the package as ESM**

Read the resolved versions out of the generated `package-lock.json` and rewrite `package.json` so every entry in `dependencies`/`devDependencies` is an exact version (no `^`/`~`). Also add:

```json
{
  "type": "module",
  "main": "dist/main.js"
}
```

- [ ] **Step 3: Add `tsconfig.json` configured for native ESM**

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "types": ["vitest/globals"]
  }
}
```

- [ ] **Step 4: Add `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "**/*spec.ts"]
}
```

- [ ] **Step 5: Add `nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
```

- [ ] **Step 6: Add `eslint.config.mjs` enforcing explicit return types**

```js
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowTypedFunctionExpressions: true },
      ],
    },
  },
];
```

- [ ] **Step 7: Add `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

`globals: true` makes `describe`/`it`/`expect`/`vi` available in every spec file without an explicit import, matching the mocking style (`vi.fn()`) used throughout this plan. The `types: ["vitest/globals"]` entry added to `tsconfig.json` in Step 3 is what makes TypeScript recognize those globals.

- [ ] **Step 8: Add minimal `src/app.module.ts` and `src/main.ts`**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
})
export class AppModule {}
```

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

- [ ] **Step 9: Add npm scripts to `package.json`**

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "eslint \"src/**/*.ts\"",
    "test": "vitest run"
  }
}
```

- [ ] **Step 10: Verify build and lint run clean**

Run: `npm run build && npm run lint`
Expected: both exit 0 (no source files yet beyond `app.module.ts`/`main.ts`, nothing to lint-fail). If `tsc` reports it can't find `NodeNext` module resolution rules, confirm the installed `typescript` version is 5.x or later (`NodeNext` requires it).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json eslint.config.mjs vitest.config.ts src/main.ts src/app.module.ts
git commit -m "chore: scaffold NestJS v12 ESM project with pinned deps and lint/test tooling"
```

---
### Task 2: Prisma setup, PrismaService, and local PostgreSQL

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `prisma/schema.prisma`, `src/prisma/prisma.service.ts`, `src/prisma/prisma.module.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PrismaService` (extends `PrismaClient`, has `onModuleInit`/`onModuleDestroy`), `PrismaModule` (global, exports `PrismaService`) — every later `*.db.ts` constructor-injects `PrismaService`.

- [ ] **Step 1: Install Prisma (unpinned first)**

```bash
npm install prisma -D
npm install @prisma/client
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Pin `prisma` and `@prisma/client` from `package-lock.json`**

Edit `package.json` to replace the caret versions `npm install` wrote with the exact resolved versions.

- [ ] **Step 3: Add `docker-compose.yml` for local Postgres**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: hyrox
      POSTGRES_PASSWORD: hyrox
      POSTGRES_DB: hyrox_sponsor
    ports:
      - '5432:5432'
    volumes:
      - hyrox_postgres_data:/var/lib/postgresql/data

volumes:
  hyrox_postgres_data:
```

- [ ] **Step 4: Add `.env.example`**

```
DATABASE_URL="postgresql://hyrox:hyrox@localhost:5432/hyrox_sponsor?schema=public"
```

Copy it to `.env` locally (not committed — already covered by the existing `.gitignore`'s `.env` rule).

- [ ] **Step 5: Replace `prisma/schema.prisma` generator/datasource block**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 6: Add `src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 7: Add `src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 8: Wire `PrismaModule` into `AppModule`**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
})
export class AppModule {}
```

- [ ] **Step 9: Start local Postgres and verify Prisma can connect**

Run: `docker compose up -d postgres && sleep 2 && npx prisma db pull --force 2>&1 | tail -5`
Expected: connects without auth/connection error (schema is empty, so `db pull` reports "no tables found" rather than a connection failure — that's success).

- [ ] **Step 10: Build to confirm `PrismaService` compiles**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add docker-compose.yml .env.example prisma/schema.prisma src/prisma src/app.module.ts package.json package-lock.json
git commit -m "chore: add Prisma, PrismaService/Module, and local Postgres via docker-compose"
```

---

### Task 3: dependency-cruiser hexagonal-split enforcement

**Files:**
- Create: `.dependency-cruiser.cjs`
- Modify: `package.json` (add `lint:arch` script)

**Interfaces:**
- Produces: `npm run lint:arch`, which every later task's CI-equivalent check should pass.

- [ ] **Step 1: Install dependency-cruiser (unpinned first)**

```bash
npm install -D dependency-cruiser
```

- [ ] **Step 2: Pin it from `package-lock.json`**

- [ ] **Step 3: Add `.dependency-cruiser.cjs`**

```javascript
module.exports = {
  forbidden: [
    {
      name: 'no-orm-outside-db-layer',
      comment:
        'Only *.db.ts files may import the Prisma client. *.service.ts and *.usecase.ts must stay ORM-free.',
      severity: 'error',
      from: {
        path: '^src/.+\\.(service|usecase)\\.ts$',
      },
      to: {
        path: 'node_modules/@prisma/client',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
};
```

- [ ] **Step 4: Add the `lint:arch` script**

```json
{
  "scripts": {
    "lint:arch": "depcruise src --config .dependency-cruiser.cjs"
  }
}
```

- [ ] **Step 5: Verify it passes on the current (violation-free) tree**

Run: `npm run lint:arch`
Expected: exit 0, "no dependency violations found".

- [ ] **Step 6: Prove it catches a real violation**

Temporarily create `src/athletes/tmp-violation.service.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

export class TmpViolationService {
  private readonly client = new PrismaClient();
}
```

Run: `npm run lint:arch`
Expected: exit non-zero, reports `no-orm-outside-db-layer` violation on `tmp-violation.service.ts`.

- [ ] **Step 7: Remove the temporary violation file and re-verify clean**

```bash
rm src/athletes/tmp-violation.service.ts
```

Run: `npm run lint:arch`
Expected: exit 0 again.

- [ ] **Step 8: Commit**

```bash
git add .dependency-cruiser.cjs package.json package-lock.json
git commit -m "chore: enforce hexagonal service/db split with dependency-cruiser"
```

---

### Task 4: BodyZone enum, Athlete model, and athletes module

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/athletes/athlete.db.ts`, `src/athletes/athlete.service.ts`, `src/athletes/athlete.service.spec.ts`, `src/athletes/athletes.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `AthleteDb.findById(id: string): Promise<Athlete | null>`, `AthleteService.getById(id: string): Promise<Athlete>` (throws `NotFoundException` when missing). Later tasks' FKs to `Athlete` rely on the Prisma model name `Athlete` and its `id: String @id`.

- [ ] **Step 1: Add `BodyZone` enum and `Athlete` model to `prisma/schema.prisma`**

```prisma
enum BodyZone {
  LEFT_PEC
  RIGHT_PEC
  UPPER_BACK
  LOWER_BACK
  LEFT_ARM
  RIGHT_ARM
  LEFT_THIGH
  RIGHT_THIGH
  ASS

  @@map("body_zone")
}

model Athlete {
  id                       String    @id @default(cuid())
  name                     String
  email                    String    @unique
  isAdult                  Boolean   @default(false) @map("is_adult")
  adultAttestedAt          DateTime? @map("adult_attested_at") @db.Timestamptz(3)
  trustScore               Int       @default(50) @map("trust_score")
  strikeCount              Int       @default(0) @map("strike_count")
  isBanned                 Boolean   @default(false) @map("is_banned")
  lifetimeSponsorshipCents Int       @default(0) @map("lifetime_sponsorship_cents")
  stripeConnectAccountId   String?   @map("stripe_connect_account_id")
  createdAt                DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt                DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("athletes")
}
```

`stripeConnectAccountId` holds the athlete's own Stripe Connect account id for payouts (nullable until the athlete completes onboarding), consumed later by HYR-14 — same shape as `Bidder.stripeCustomerId`.

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_athlete`
Expected: creates `prisma/migrations/<timestamp>_add_athlete/migration.sql`, applies cleanly against the local Postgres from Task 2, regenerates the Prisma client.

- [ ] **Step 3: Write the failing service test**

```typescript
// src/athletes/athlete.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { AthleteService } from './athlete.service.js';
import { AthleteDb } from './athlete.db.js';

describe('AthleteService', () => {
  describe('getById', () => {
    describe('when the athlete exists', () => {
      it('returns the athlete', async () => {
        const athlete = { id: 'athlete-1', name: 'Jamie Lee' };
        const db = { findById: vi.fn().mockResolvedValue(athlete) } as unknown as AthleteDb;
        const service = new AthleteService(db);

        const result = await service.getById('athlete-1');

        expect(result).toEqual(athlete);
      });
    });

    describe('when the athlete does not exist', () => {
      it('throws NotFoundException', async () => {
        const db = { findById: vi.fn().mockResolvedValue(null) } as unknown as AthleteDb;
        const service = new AthleteService(db);

        await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
      });
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- athlete.service.spec.ts`
Expected: FAIL — `athlete.service.ts`/`athlete.db.ts` don't exist yet.

- [ ] **Step 5: Implement `athlete.db.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Athlete } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AthleteDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Athlete | null> {
    return this.prisma.athlete.findUnique({ where: { id } });
  }
}
```

- [ ] **Step 6: Implement `athlete.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Athlete } from '@prisma/client';
import { AthleteDb } from './athlete.db.js';

@Injectable()
export class AthleteService {
  constructor(private readonly db: AthleteDb) {}

  async getById(id: string): Promise<Athlete> {
    const athlete = await this.db.findById(id);

    if (!athlete) {
      throw new NotFoundException(`Athlete ${id} not found`);
    }

    return athlete;
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- athlete.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Add `athletes.module.ts` and wire it into `AppModule`**

```typescript
// src/athletes/athletes.module.ts
import { Module } from '@nestjs/common';
import { AthleteDb } from './athlete.db.js';
import { AthleteService } from './athlete.service.js';

@Module({
  providers: [AthleteService, AthleteDb],
  exports: [AthleteService],
})
export class AthletesModule {}
```

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AthletesModule } from './athletes/athletes.module.js';

@Module({
  imports: [PrismaModule, AthletesModule],
})
export class AppModule {}
```

- [ ] **Step 9: Verify lint, lint:arch, build, and full test suite**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/athletes src/app.module.ts
git commit -m "feat: add BodyZone enum, Athlete model, and athletes module"
```

---

### Task 5: Bidder model and bidders module

**Files:**
- Modify: `prisma/schema.prisma`, `src/app.module.ts`
- Create: `src/bidders/bidder.db.ts`, `src/bidders/bidder.service.ts`, `src/bidders/bidder.service.spec.ts`, `src/bidders/bidders.module.ts`

**Interfaces:**
- Consumes: nothing from other modules.
- Produces: `BidderDb.findByEmail(email: string): Promise<Bidder | null>`, `BidderDb.upsertByEmail(email: string): Promise<Bidder>`, `BidderService.getOrCreateByEmail(email: string): Promise<Bidder>`. Later `Bid` model FKs to `Bidder.id`.

- [ ] **Step 1: Add `Bidder` model to `prisma/schema.prisma`**

```prisma
model Bidder {
  id               String   @id @default(cuid())
  email            String   @unique
  stripeCustomerId String?  @map("stripe_customer_id")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("bidders")
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_bidder`
Expected: applies cleanly.

- [ ] **Step 3: Write the failing service test**

```typescript
// src/bidders/bidder.service.spec.ts
import { BidderService } from './bidder.service.js';
import { BidderDb } from './bidder.db.js';

describe('BidderService', () => {
  describe('getOrCreateByEmail', () => {
    it('delegates to the db upsert and returns the bidder', async () => {
      const bidder = { id: 'bidder-1', email: 'brand@example.com' };
      const db = { upsertByEmail: vi.fn().mockResolvedValue(bidder) } as unknown as BidderDb;
      const service = new BidderService(db);

      const result = await service.getOrCreateByEmail('brand@example.com');

      expect(db.upsertByEmail).toHaveBeenCalledWith('brand@example.com');
      expect(result).toEqual(bidder);
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- bidder.service.spec.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `bidder.db.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Bidder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BidderDb {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { email } });
  }

  upsertByEmail(email: string): Promise<Bidder> {
    return this.prisma.bidder.upsert({
      where: { email },
      create: { email },
      update: {},
    });
  }
}
```

- [ ] **Step 6: Implement `bidder.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Bidder } from '@prisma/client';
import { BidderDb } from './bidder.db.js';

@Injectable()
export class BidderService {
  constructor(private readonly db: BidderDb) {}

  getOrCreateByEmail(email: string): Promise<Bidder> {
    return this.db.upsertByEmail(email);
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- bidder.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Add `bidders.module.ts` and wire into `AppModule`**

```typescript
// src/bidders/bidders.module.ts
import { Module } from '@nestjs/common';
import { BidderDb } from './bidder.db.js';
import { BidderService } from './bidder.service.js';

@Module({
  providers: [BidderService, BidderDb],
  exports: [BidderService],
})
export class BiddersModule {}
```

Add `BiddersModule` to the `imports` array in `src/app.module.ts` alongside `AthletesModule`.

- [ ] **Step 9: Verify lint, lint:arch, build, tests**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/bidders src/app.module.ts
git commit -m "feat: add Bidder model and bidders module"
```

---

### Task 6: ZoneFloorPrice model and zones module

**Files:**
- Modify: `prisma/schema.prisma`, `src/app.module.ts`
- Create: `src/zones/zone-floor-price.db.ts`, `src/zones/zone-floor-price.service.ts`, `src/zones/zone-floor-price.service.spec.ts`, `src/zones/zones.module.ts`

**Interfaces:**
- Consumes: `Athlete` model (Task 4), `BodyZone` enum (Task 4).
- Produces: `ZoneFloorPriceDb.findByAthleteAndZone(athleteId: string, zone: BodyZone): Promise<ZoneFloorPrice | null>`, `ZoneFloorPriceService.getFloorPriceCents(athleteId: string, zone: BodyZone): Promise<number>` (defaults to the $10 platform minimum, 1000, if the athlete hasn't set one).

- [ ] **Step 1: Add `ZoneFloorPrice` model to `prisma/schema.prisma`**

```prisma
model ZoneFloorPrice {
  id              String   @id @default(cuid())
  athleteId       String   @map("athlete_id")
  zone            BodyZone
  floorPriceCents Int      @map("floor_price_cents")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  athlete Athlete @relation(fields: [athleteId], references: [id])

  @@unique([athleteId, zone])
  @@map("zone_floor_prices")
}
```

Also add the reverse relation field to `Athlete`:

```prisma
model Athlete {
  // ...existing fields...
  zoneFloorPrices ZoneFloorPrice[]
}
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_zone_floor_price --create-only`

- [ ] **Step 3: Hand-edit the generated migration to add the $10 minimum check constraint**

Prisma's schema DSL has no portable way to express a `CHECK` constraint here, so append raw SQL to the bottom of the generated `prisma/migrations/<timestamp>_add_zone_floor_price/migration.sql`:

```sql
ALTER TABLE "zone_floor_prices"
  ADD CONSTRAINT "floor_price_minimum_1000_cents"
  CHECK ("floor_price_cents" >= 1000);
```

- [ ] **Step 4: Apply the migration**

Run: `npx prisma migrate dev`
Expected: applies cleanly, regenerates the client.

- [ ] **Step 5: Verify the check constraint is enforced at the DB level**

Run:

```bash
npx prisma db execute --stdin <<'EOF'
INSERT INTO "athletes" (id, name, email) VALUES ('athlete-test-1', 'Test Athlete', 'test1@example.com');
INSERT INTO "zone_floor_prices" (id, "athlete_id", zone, "floor_price_cents", "updated_at") VALUES ('zfp-test-1', 'athlete-test-1', 'ASS', 500, now());
EOF
```

Expected: fails with a check-constraint violation on `floor_price_minimum_1000_cents`. Then clean up:

```bash
npx prisma db execute --stdin <<'EOF'
DELETE FROM "athletes" WHERE id = 'athlete-test-1';
EOF
```

- [ ] **Step 6: Write the failing service test**

```typescript
// src/zones/zone-floor-price.service.spec.ts
import { ZoneFloorPriceService } from './zone-floor-price.service.js';
import { ZoneFloorPriceDb } from './zone-floor-price.db.js';

describe('ZoneFloorPriceService', () => {
  describe('getFloorPriceCents', () => {
    describe('when the athlete has set a floor for the zone', () => {
      it('returns the stored floor price', async () => {
        const db = {
          findByAthleteAndZone: vi.fn().mockResolvedValue({ floorPriceCents: 2500 }),
        } as unknown as ZoneFloorPriceDb;
        const service = new ZoneFloorPriceService(db);

        const result = await service.getFloorPriceCents('athlete-1', 'LEFT_PEC');

        expect(result).toBe(2500);
      });
    });

    describe('when the athlete has not set a floor for the zone', () => {
      it('returns the platform minimum of 1000 cents', async () => {
        const db = {
          findByAthleteAndZone: vi.fn().mockResolvedValue(null),
        } as unknown as ZoneFloorPriceDb;
        const service = new ZoneFloorPriceService(db);

        const result = await service.getFloorPriceCents('athlete-1', 'LEFT_PEC');

        expect(result).toBe(1000);
      });
    });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- zone-floor-price.service.spec.ts`
Expected: FAIL.

- [ ] **Step 8: Implement `zone-floor-price.db.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { BodyZone, ZoneFloorPrice } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ZoneFloorPriceDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAthleteAndZone(athleteId: string, zone: BodyZone): Promise<ZoneFloorPrice | null> {
    return this.prisma.zoneFloorPrice.findUnique({
      where: { athleteId_zone: { athleteId, zone } },
    });
  }
}
```

- [ ] **Step 9: Implement `zone-floor-price.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { BodyZone } from '@prisma/client';
import { ZoneFloorPriceDb } from './zone-floor-price.db.js';

const PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = 1000;

@Injectable()
export class ZoneFloorPriceService {
  constructor(private readonly db: ZoneFloorPriceDb) {}

  async getFloorPriceCents(athleteId: string, zone: BodyZone): Promise<number> {
    const floorPrice = await this.db.findByAthleteAndZone(athleteId, zone);

    if (!floorPrice) {
      return PLATFORM_MINIMUM_FLOOR_PRICE_CENTS;
    }

    return floorPrice.floorPriceCents;
  }
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm test -- zone-floor-price.service.spec.ts`
Expected: PASS.

- [ ] **Step 11: Add `zones.module.ts` and wire into `AppModule`**

```typescript
// src/zones/zones.module.ts
import { Module } from '@nestjs/common';
import { ZoneFloorPriceDb } from './zone-floor-price.db.js';
import { ZoneFloorPriceService } from './zone-floor-price.service.js';

@Module({
  providers: [ZoneFloorPriceService, ZoneFloorPriceDb],
  exports: [ZoneFloorPriceService],
})
export class ZonesModule {}
```

Add `ZonesModule` to `AppModule`'s `imports`.

- [ ] **Step 12: Verify lint, lint:arch, build, tests**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/zones src/app.module.ts
git commit -m "feat: add ZoneFloorPrice model with $10 minimum check constraint, zones module"
```

---

### Task 7: Race and RaceEntry models, races module

**Files:**
- Modify: `prisma/schema.prisma`, `src/app.module.ts`
- Create: `src/races/race.db.ts`, `src/races/race.service.ts`, `src/races/race.service.spec.ts`, `src/races/race-entry.db.ts`, `src/races/race-entry.service.ts`, `src/races/race-entry.service.spec.ts`, `src/races/races.module.ts`

**Interfaces:**
- Consumes: `Athlete` model (Task 4).
- Produces: `RaceDb.findById(id: string): Promise<Race | null>`, `RaceService.getById(id: string): Promise<Race>`; `RaceEntryDb.findByAthleteAndRace(athleteId: string, raceId: string): Promise<RaceEntry | null>`, `RaceEntryService.isVerified(athleteId: string, raceId: string): Promise<boolean>`. Later `Auction` model FKs to `RaceEntry.id`.

- [ ] **Step 1: Add `Race` and `RaceEntry` models to `prisma/schema.prisma`**

```prisma
model Race {
  id        String   @id @default(cuid())
  name      String
  date      DateTime
  timezone  String
  location  String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  raceEntries RaceEntry[]

  @@map("races")
}

enum RaceEntryVerificationStatus {
  PENDING
  VERIFIED
  REJECTED

  @@map("race_entry_verification_status")
}

model RaceEntry {
  id                      String                       @id @default(cuid())
  athleteId               String                       @map("athlete_id")
  raceId                  String                       @map("race_id")
  bibNumber               String                       @map("bib_number")
  verificationStatus      RaceEntryVerificationStatus  @default(PENDING) @map("verification_status")
  verificationDocumentUrl String?                      @map("verification_document_url")
  verifiedAt              DateTime?                    @map("verified_at") @db.Timestamptz(3)
  verifiedBy              String?                      @map("verified_by")
  raceDate                DateTime                     @map("race_date") @db.Timestamptz(3)
  raceLocalDate           DateTime                     @map("race_local_date") @db.Date
  createdAt               DateTime                     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt               DateTime                     @updatedAt @map("updated_at") @db.Timestamptz(3)

  athlete Athlete @relation(fields: [athleteId], references: [id])
  race    Race    @relation(fields: [raceId], references: [id])

  @@unique([athleteId, raceLocalDate])
  @@index([raceId])
  @@map("race_entries")
}
```

Add the reverse relation to `Athlete`:

```prisma
model Athlete {
  // ...existing fields...
  raceEntries RaceEntry[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_race_and_race_entry`
Expected: applies cleanly, including the `(athleteId, raceLocalDate)` unique index and the `raceId` index. `raceLocalDate` is `@db.Date`: the race's calendar date in `Race.timezone`, computed by the application at entry-creation time (no creation code in this ticket) and stored alongside the immutable `raceDate` instant.

- [ ] **Step 3: Verify the same-day double-entry constraint at the DB level**

```bash
npx prisma db execute --schema prisma/schema.prisma --stdin <<'EOF'
INSERT INTO "athletes" (id, name, email, "updated_at") VALUES ('athlete-test-2', 'Test Athlete Two', 'test2@example.com', now());
INSERT INTO "races" (id, name, date, timezone, location, "updated_at") VALUES ('race-a', 'Race A', '2026-11-01T08:00:00Z', 'Europe/Paris', 'Paris', now());
INSERT INTO "races" (id, name, date, timezone, location, "updated_at") VALUES ('race-b', 'Race B', '2026-11-01T15:30:00Z', 'Europe/Paris', 'Paris', now());
INSERT INTO "race_entries" (id, "athlete_id", "race_id", "bib_number", "race_date", "race_local_date", "updated_at") VALUES ('entry-a', 'athlete-test-2', 'race-a', '101', '2026-11-01T08:00:00Z', '2026-11-01', now());
INSERT INTO "race_entries" (id, "athlete_id", "race_id", "bib_number", "race_date", "race_local_date", "updated_at") VALUES ('entry-b', 'athlete-test-2', 'race-b', '202', '2026-11-01T15:30:00Z', '2026-11-01', now());
EOF
```

Expected: the second `RaceEntry` insert fails on the `race_entries_athlete_id_race_local_date_key` unique constraint: the two entries have different `race_date` instants (08:00Z vs 15:30Z) and different races, but the same `race_local_date`. Clean up:

```bash
npx prisma db execute --schema prisma/schema.prisma --stdin <<'EOF'
DELETE FROM "race_entries" WHERE "athlete_id" = 'athlete-test-2';
DELETE FROM "athletes" WHERE id = 'athlete-test-2';
DELETE FROM "races" WHERE id IN ('race-a', 'race-b');
EOF
```

- [ ] **Step 4: Write the failing `RaceService` test**

```typescript
// src/races/race.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { RaceService } from './race.service.js';
import { RaceDb } from './race.db.js';

describe('RaceService', () => {
  describe('getById', () => {
    describe('when the race exists', () => {
      it('returns the race', async () => {
        const race = { id: 'race-1', name: 'Chicago Hyrox' };
        const db = { findById: vi.fn().mockResolvedValue(race) } as unknown as RaceDb;
        const service = new RaceService(db);

        const result = await service.getById('race-1');

        expect(result).toEqual(race);
      });
    });

    describe('when the race does not exist', () => {
      it('throws NotFoundException', async () => {
        const db = { findById: vi.fn().mockResolvedValue(null) } as unknown as RaceDb;
        const service = new RaceService(db);

        await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
      });
    });
  });
});
```

- [ ] **Step 5: Write the failing `RaceEntryService` test**

```typescript
// src/races/race-entry.service.spec.ts
import { RaceEntryService } from './race-entry.service.js';
import { RaceEntryDb } from './race-entry.db.js';

describe('RaceEntryService', () => {
  describe('isVerified', () => {
    describe('when no race entry exists', () => {
      it('returns false', async () => {
        const db = {
          findByAthleteAndRace: vi.fn().mockResolvedValue(null),
        } as unknown as RaceEntryDb;
        const service = new RaceEntryService(db);

        const result = await service.isVerified('athlete-1', 'race-1');

        expect(result).toBe(false);
      });
    });

    describe('when the race entry is VERIFIED', () => {
      it('returns true', async () => {
        const db = {
          findByAthleteAndRace: vi
            .fn()
            .mockResolvedValue({ verificationStatus: 'VERIFIED' }),
        } as unknown as RaceEntryDb;
        const service = new RaceEntryService(db);

        const result = await service.isVerified('athlete-1', 'race-1');

        expect(result).toBe(true);
      });
    });

    describe('when the race entry is PENDING', () => {
      it('returns false', async () => {
        const db = {
          findByAthleteAndRace: vi
            .fn()
            .mockResolvedValue({ verificationStatus: 'PENDING' }),
        } as unknown as RaceEntryDb;
        const service = new RaceEntryService(db);

        const result = await service.isVerified('athlete-1', 'race-1');

        expect(result).toBe(false);
      });
    });
  });
});
```

- [ ] **Step 6: Run both tests to verify they fail**

Run: `npm test -- race.service.spec.ts race-entry.service.spec.ts`
Expected: FAIL (files don't exist yet).

- [ ] **Step 7: Implement `race.db.ts` and `race.service.ts`**

```typescript
// src/races/race.db.ts
import { Injectable } from '@nestjs/common';
import { Race } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RaceDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Race | null> {
    return this.prisma.race.findUnique({ where: { id } });
  }
}
```

```typescript
// src/races/race.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Race } from '@prisma/client';
import { RaceDb } from './race.db.js';

@Injectable()
export class RaceService {
  constructor(private readonly db: RaceDb) {}

  async getById(id: string): Promise<Race> {
    const race = await this.db.findById(id);

    if (!race) {
      throw new NotFoundException(`Race ${id} not found`);
    }

    return race;
  }
}
```

- [ ] **Step 8: Implement `race-entry.db.ts` and `race-entry.service.ts`**

```typescript
// src/races/race-entry.db.ts
import { Injectable } from '@nestjs/common';
import { RaceEntry } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RaceEntryDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAthleteAndRace(athleteId: string, raceId: string): Promise<RaceEntry | null> {
    return this.prisma.raceEntry.findFirst({ where: { athleteId, raceId } });
  }
}
```

```typescript
// src/races/race-entry.service.ts
import { Injectable } from '@nestjs/common';
import { RaceEntryDb } from './race-entry.db.js';

type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

@Injectable()
export class RaceEntryService {
  constructor(private readonly db: RaceEntryDb) {}

  async isVerified(athleteId: string, raceId: string): Promise<boolean> {
    const entry = await this.db.findByAthleteAndRace(athleteId, raceId);

    if (!entry) {
      return false;
    }

    const verificationStatus = entry.verificationStatus as VerificationStatus;

    return verificationStatus === 'VERIFIED';
  }
}
```

`VerificationStatus` is a local literal union mirroring the `RaceEntryVerificationStatus` Prisma enum's members — `race-entry.service.ts` must never import `@prisma/client` (hexagonal split), so it cannot reference the generated enum directly. `race-entry.db.ts` is allowed to return Prisma's own inferred type; the service narrows it explicitly here instead of trusting an implicit `string`.

- [ ] **Step 9: Run both tests to verify they pass**

Run: `npm test -- race.service.spec.ts race-entry.service.spec.ts`
Expected: PASS.

- [ ] **Step 10: Add `races.module.ts` and wire into `AppModule`**

```typescript
// src/races/races.module.ts
import { Module } from '@nestjs/common';
import { RaceDb } from './race.db.js';
import { RaceService } from './race.service.js';
import { RaceEntryDb } from './race-entry.db.js';
import { RaceEntryService } from './race-entry.service.js';

@Module({
  providers: [RaceService, RaceDb, RaceEntryService, RaceEntryDb],
  exports: [RaceService, RaceEntryService],
})
export class RacesModule {}
```

Add `RacesModule` to `AppModule`'s `imports`.

- [ ] **Step 11: Verify lint, lint:arch, build, tests**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/races src/app.module.ts
git commit -m "feat: add Race and RaceEntry models with same-day-entry constraint, races module"
```

---

### Task 8: Auction model and auctions module

**Files:**
- Modify: `prisma/schema.prisma`, `src/app.module.ts`
- Create: `src/auctions/auction.db.ts`, `src/auctions/auction.service.ts`, `src/auctions/auction.service.spec.ts`, `src/auctions/auctions.module.ts`

**Interfaces:**
- Consumes: `RaceEntry` model (Task 7), `BodyZone` enum (Task 4).
- Produces: `AuctionDb.findById(id: string): Promise<Auction | null>`, `AuctionService.getById(id: string): Promise<Auction>`. `Auction.id`, `Auction.status`, `Auction.outcome` fields are what Tasks 9-11 (Bid, EscrowTransaction, SponsorshipProof, Dispute) FK against.

- [ ] **Step 1: Add `Auction` model to `prisma/schema.prisma`**

Note: `currentLeadingBidId` references `Bid`, which doesn't exist until Task 9. Add it as a plain nullable `String` column here (no FK relation yet) and convert it to a real relation in Task 9 once `Bid` exists — this keeps each migration self-contained and applicable independently.

```prisma
enum AuctionStatus {
  SCHEDULED
  OPEN
  CLOSED

  @@map("auction_status")
}

enum AuctionOutcome {
  PENDING
  AWAITING_PROOF
  COMPLETED
  REFUNDED
  DISPUTED
  FORFEITED_FEE

  @@map("auction_outcome")
}

model Auction {
  id                  String         @id @default(cuid())
  raceEntryId         String         @map("race_entry_id")
  zone                BodyZone
  floorPriceCents     Int            @map("floor_price_cents")
  openAt              DateTime       @map("open_at") @db.Timestamptz(3)
  closeAt             DateTime       @map("close_at") @db.Timestamptz(3)
  proofDeadlineAt     DateTime?      @map("proof_deadline_at") @db.Timestamptz(3)
  status              AuctionStatus  @default(SCHEDULED)
  outcome             AuctionOutcome @default(PENDING)
  currentLeadingBidId String?        @map("current_leading_bid_id")
  commissionCents     Int?           @map("commission_cents")
  processingFeeCents  Int?           @map("processing_fee_cents")
  createdAt           DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime       @updatedAt @map("updated_at") @db.Timestamptz(3)

  raceEntry RaceEntry @relation(fields: [raceEntryId], references: [id])

  @@unique([raceEntryId, zone])
  @@index([status, openAt, closeAt])
  @@map("auctions")
}
```

Add the reverse relation to `RaceEntry`:

```prisma
model RaceEntry {
  // ...existing fields...
  auctions Auction[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_auction`
Expected: applies cleanly.

- [ ] **Step 3: Write the failing service test**

```typescript
// src/auctions/auction.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { AuctionService } from './auction.service.js';
import { AuctionDb } from './auction.db.js';

describe('AuctionService', () => {
  describe('getById', () => {
    describe('when the auction exists', () => {
      it('returns the auction', async () => {
        const auction = { id: 'auction-1', zone: 'LEFT_PEC' };
        const db = { findById: vi.fn().mockResolvedValue(auction) } as unknown as AuctionDb;
        const service = new AuctionService(db);

        const result = await service.getById('auction-1');

        expect(result).toEqual(auction);
      });
    });

    describe('when the auction does not exist', () => {
      it('throws NotFoundException', async () => {
        const db = { findById: vi.fn().mockResolvedValue(null) } as unknown as AuctionDb;
        const service = new AuctionService(db);

        await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
      });
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- auction.service.spec.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `auction.db.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Auction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuctionDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Auction | null> {
    return this.prisma.auction.findUnique({ where: { id } });
  }
}
```

- [ ] **Step 6: Implement `auction.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Auction } from '@prisma/client';
import { AuctionDb } from './auction.db.js';

@Injectable()
export class AuctionService {
  constructor(private readonly db: AuctionDb) {}

  async getById(id: string): Promise<Auction> {
    const auction = await this.db.findById(id);

    if (!auction) {
      throw new NotFoundException(`Auction ${id} not found`);
    }

    return auction;
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- auction.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Add `auctions.module.ts` and wire into `AppModule`**

```typescript
// src/auctions/auctions.module.ts
import { Module } from '@nestjs/common';
import { AuctionDb } from './auction.db.js';
import { AuctionService } from './auction.service.js';

@Module({
  providers: [AuctionService, AuctionDb],
  exports: [AuctionService],
})
export class AuctionsModule {}
```

Add `AuctionsModule` to `AppModule`'s `imports`.

- [ ] **Step 9: Verify lint, lint:arch, build, tests**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/auctions src/app.module.ts
git commit -m "feat: add Auction model (status/outcome split, window/commission fields), auctions module"
```

---

### Task 9: Bid model, leading-bid partial unique index, bids module

**Files:**
- Modify: `prisma/schema.prisma`, `src/app.module.ts`
- Create: `src/bids/bid.db.ts`, `src/bids/bid.service.ts`, `src/bids/bid.service.spec.ts`, `src/bids/bids.module.ts`

**Interfaces:**
- Consumes: `Auction` model (Task 8), `Bidder` model (Task 5).
- Produces: `BidDb.findLeadingForAuction(auctionId: string): Promise<Bid | null>`, `BidService.getLeadingBid(auctionId: string): Promise<Bid | null>`. Later `EscrowTransaction` model FKs to `Bid.id`.

- [ ] **Step 1: Add `Bid` model and the `Auction.currentLeadingBid` relation to `prisma/schema.prisma`**

```prisma
enum BidStatus {
  LEADING
  OUTBID
  WITHDRAWN
  WON
  LOST

  @@map("bid_status")
}

model Bid {
  id          String    @id @default(cuid())
  auctionId   String    @map("auction_id")
  bidderId    String    @map("bidder_id")
  amountCents Int       @map("amount_cents")
  placedAt    DateTime  @default(now()) @map("placed_at") @db.Timestamptz(3)
  status      BidStatus @default(LEADING)

  auction           Auction @relation("AuctionBids", fields: [auctionId], references: [id])
  bidder            Bidder  @relation(fields: [bidderId], references: [id])
  leadingForAuction Auction? @relation("AuctionLeadingBid")

  @@index([auctionId, status])
  @@index([bidderId])
  @@map("bids")
}
```

Update `Auction` to add the reverse relations and turn `currentLeadingBidId` into a real FK:

```prisma
model Auction {
  // ...existing fields...
  currentLeadingBidId String? @unique @map("current_leading_bid_id")

  bids              Bid[]  @relation("AuctionBids")
  currentLeadingBid Bid?   @relation("AuctionLeadingBid", fields: [currentLeadingBidId], references: [id])
}
```

Add the reverse relation to `Bidder`:

```prisma
model Bidder {
  // ...existing fields...
  bids Bid[]
}
```

- [ ] **Step 2: Generate the migration without applying it yet**

Run: `npx prisma migrate dev --name add_bid --create-only`

- [ ] **Step 3: Hand-edit the generated migration to add the partial unique index**

Prisma's schema DSL has no way to express a filtered/partial unique index, so append raw SQL to the bottom of `prisma/migrations/<timestamp>_add_bid/migration.sql`:

```sql
CREATE UNIQUE INDEX "bid_one_leading_per_auction"
  ON "bids" ("auction_id")
  WHERE "status" = 'LEADING';
```

- [ ] **Step 4: Apply the migration**

Run: `npx prisma migrate dev`
Expected: applies cleanly, `Bid` table and the partial index both exist.

- [ ] **Step 5: Verify the partial unique index rejects two leading bids on the same auction**

```bash
npx prisma db execute --stdin <<'EOF'
INSERT INTO "athletes" (id, name, email, "updated_at") VALUES ('athlete-test-3', 'Test Athlete Three', 'test3@example.com', now());
INSERT INTO "bidders" (id, email, "updated_at") VALUES ('bidder-test-1', 'bidder1@example.com', now());
INSERT INTO "bidders" (id, email, "updated_at") VALUES ('bidder-test-2', 'bidder2@example.com', now());
INSERT INTO "races" (id, name, date, timezone, location, "updated_at") VALUES ('race-c', 'Race C', '2026-11-08T08:00:00Z', 'America/Chicago', 'Chicago', now());
INSERT INTO "race_entries" (id, "athlete_id", "race_id", "bib_number", "race_date", "race_local_date", "updated_at") VALUES ('entry-c', 'athlete-test-3', 'race-c', '303', '2026-11-08T08:00:00Z', '2026-11-08', now());
INSERT INTO "auctions" (id, "race_entry_id", zone, "floor_price_cents", "open_at", "close_at", "updated_at") VALUES ('auction-c', 'entry-c', 'ASS', 1000, '2026-11-01T08:00:00Z', '2026-11-03T08:00:00Z', now());
INSERT INTO "bids" (id, "auction_id", "bidder_id", "amount_cents", status) VALUES ('bid-c1', 'auction-c', 'bidder-test-1', 1500, 'LEADING');
INSERT INTO "bids" (id, "auction_id", "bidder_id", "amount_cents", status) VALUES ('bid-c2', 'auction-c', 'bidder-test-2', 2000, 'LEADING');
EOF
```

Expected: the second `Bid` insert fails on `bid_one_leading_per_auction`. Clean up:

```bash
npx prisma db execute --stdin <<'EOF'
DELETE FROM "athletes" WHERE id = 'athlete-test-3';
DELETE FROM "bidders" WHERE id IN ('bidder-test-1', 'bidder-test-2');
DELETE FROM "races" WHERE id = 'race-c';
EOF
```

- [ ] **Step 6: Write the failing service test**

```typescript
// src/bids/bid.service.spec.ts
import { BidService } from './bid.service.js';
import { BidDb } from './bid.db.js';

describe('BidService', () => {
  describe('getLeadingBid', () => {
    describe('when a leading bid exists', () => {
      it('returns it', async () => {
        const bid = { id: 'bid-1', status: 'LEADING' };
        const db = { findLeadingForAuction: vi.fn().mockResolvedValue(bid) } as unknown as BidDb;
        const service = new BidService(db);

        const result = await service.getLeadingBid('auction-1');

        expect(result).toEqual(bid);
      });
    });

    describe('when no leading bid exists', () => {
      it('returns null', async () => {
        const db = {
          findLeadingForAuction: vi.fn().mockResolvedValue(null),
        } as unknown as BidDb;
        const service = new BidService(db);

        const result = await service.getLeadingBid('auction-1');

        expect(result).toBeNull();
      });
    });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- bid.service.spec.ts`
Expected: FAIL.

- [ ] **Step 8: Implement `bid.db.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Bid } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BidDb {
  constructor(private readonly prisma: PrismaService) {}

  findLeadingForAuction(auctionId: string): Promise<Bid | null> {
    return this.prisma.bid.findFirst({
      where: { auctionId, status: 'LEADING' },
    });
  }
}
```

- [ ] **Step 9: Implement `bid.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Bid } from '@prisma/client';
import { BidDb } from './bid.db.js';

@Injectable()
export class BidService {
  constructor(private readonly db: BidDb) {}

  getLeadingBid(auctionId: string): Promise<Bid | null> {
    return this.db.findLeadingForAuction(auctionId);
  }
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm test -- bid.service.spec.ts`
Expected: PASS.

- [ ] **Step 11: Add `bids.module.ts` and wire into `AppModule`**

```typescript
// src/bids/bids.module.ts
import { Module } from '@nestjs/common';
import { BidDb } from './bid.db.js';
import { BidService } from './bid.service.js';

@Module({
  providers: [BidService, BidDb],
  exports: [BidService],
})
export class BidsModule {}
```

Add `BidsModule` to `AppModule`'s `imports`.

- [ ] **Step 12: Verify lint, lint:arch, build, tests**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/bids src/app.module.ts
git commit -m "feat: add Bid model with partial unique leading-bid index, bids module"
```

---

### Task 10: EscrowTransaction model and escrow module

**Files:**
- Modify: `prisma/schema.prisma`, `src/app.module.ts`
- Create: `src/escrow/escrow-transaction.db.ts`, `src/escrow/escrow-transaction.service.ts`, `src/escrow/escrow-transaction.service.spec.ts`, `src/escrow/escrow.module.ts`

**Interfaces:**
- Consumes: `Bid` model (Task 9).
- Produces: `EscrowTransactionDb.findLatestForBid(bidId: string): Promise<EscrowTransaction | null>`, `EscrowTransactionService.hasActiveAuthorization(bidId: string): Promise<boolean>`.

- [ ] **Step 1: Add `EscrowTransaction` model to `prisma/schema.prisma`**

```prisma
enum EscrowTransactionType {
  AUTHORIZED
  VOIDED
  CAPTURED
  REFUNDED
  FAILED

  @@map("escrow_transaction_type")
}

model EscrowTransaction {
  id                    String                @id @default(cuid())
  bidId                 String                @map("bid_id")
  stripePaymentIntentId String                @map("stripe_payment_intent_id")
  type                  EscrowTransactionType
  amountCents           Int                   @map("amount_cents")
  createdAt             DateTime              @default(now()) @map("created_at") @db.Timestamptz(3)

  bid Bid @relation(fields: [bidId], references: [id])

  @@index([bidId, type])
  @@map("escrow_transactions")
}
```

Add the reverse relation to `Bid`:

```prisma
model Bid {
  // ...existing fields...
  escrowTransactions EscrowTransaction[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_escrow_transaction`
Expected: applies cleanly.

- [ ] **Step 3: Write the failing service test**

```typescript
// src/escrow/escrow-transaction.service.spec.ts
import { EscrowTransactionService } from './escrow-transaction.service.js';
import { EscrowTransactionDb } from './escrow-transaction.db.js';

describe('EscrowTransactionService', () => {
  describe('hasActiveAuthorization', () => {
    describe('when an AUTHORIZED transaction exists for the bid', () => {
      it('returns true', async () => {
        const db = {
          findLatestForBid: vi
            .fn()
            .mockResolvedValue({ id: 'escrow-1', type: 'AUTHORIZED' }),
        } as unknown as EscrowTransactionDb;
        const service = new EscrowTransactionService(db);

        const result = await service.hasActiveAuthorization('bid-1');

        expect(result).toBe(true);
      });
    });

    describe('when no AUTHORIZED transaction exists for the bid', () => {
      it('returns false', async () => {
        const db = {
          findLatestForBid: vi.fn().mockResolvedValue(null),
        } as unknown as EscrowTransactionDb;
        const service = new EscrowTransactionService(db);

        const result = await service.hasActiveAuthorization('bid-1');

        expect(result).toBe(false);
      });
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- escrow-transaction.service.spec.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `escrow-transaction.db.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { EscrowTransaction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class EscrowTransactionDb {
  constructor(private readonly prisma: PrismaService) {}

  findLatestForBid(bidId: string): Promise<EscrowTransaction | null> {
    return this.prisma.escrowTransaction.findFirst({
      where: { bidId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
```

- [ ] **Step 6: Implement `escrow-transaction.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { EscrowTransactionDb } from './escrow-transaction.db.js';

@Injectable()
export class EscrowTransactionService {
  constructor(private readonly db: EscrowTransactionDb) {}

  async hasActiveAuthorization(bidId: string): Promise<boolean> {
    const latest = await this.db.findLatestForBid(bidId);

    return latest?.type === 'AUTHORIZED';
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- escrow-transaction.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Add `escrow.module.ts` and wire into `AppModule`**

```typescript
// src/escrow/escrow.module.ts
import { Module } from '@nestjs/common';
import { EscrowTransactionDb } from './escrow-transaction.db.js';
import { EscrowTransactionService } from './escrow-transaction.service.js';

@Module({
  providers: [EscrowTransactionService, EscrowTransactionDb],
  exports: [EscrowTransactionService],
})
export class EscrowModule {}
```

Add `EscrowModule` to `AppModule`'s `imports`.

- [ ] **Step 9: Verify lint, lint:arch, build, tests**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/escrow src/app.module.ts
git commit -m "feat: add EscrowTransaction audit-log model, escrow module"
```

---

### Task 11: SponsorshipProof and Dispute models, proofs and disputes modules

**Files:**
- Modify: `prisma/schema.prisma`, `src/app.module.ts`
- Create: `src/proofs/sponsorship-proof.db.ts`, `src/proofs/sponsorship-proof.service.ts`, `src/proofs/sponsorship-proof.service.spec.ts`, `src/proofs/proofs.module.ts`, `src/disputes/dispute.db.ts`, `src/disputes/dispute.service.ts`, `src/disputes/dispute.service.spec.ts`, `src/disputes/disputes.module.ts`

**Interfaces:**
- Consumes: `Auction` model (Task 8).
- Produces: `SponsorshipProofDb.findByAuctionId(auctionId: string): Promise<SponsorshipProof | null>`, `SponsorshipProofService.getByAuctionId(auctionId: string): Promise<SponsorshipProof | null>`; `DisputeDb.findOpenForAuction(auctionId: string): Promise<Dispute | null>`, `DisputeService.hasOpenDispute(auctionId: string): Promise<boolean>`.

- [ ] **Step 1: Add `SponsorshipProof` and `Dispute` models to `prisma/schema.prisma`**

```prisma
enum ProofReviewStatus {
  PENDING
  APPROVED
  REJECTED

  @@map("proof_review_status")
}

model SponsorshipProof {
  id           String            @id @default(cuid())
  auctionId    String            @unique @map("auction_id")
  mediaUrl     String            @map("media_url")
  submittedAt  DateTime          @default(now()) @map("submitted_at") @db.Timestamptz(3)
  reviewStatus ProofReviewStatus @default(PENDING) @map("review_status")
  reviewedBy   String?           @map("reviewed_by")
  reviewedAt   DateTime?         @map("reviewed_at") @db.Timestamptz(3)

  auction Auction @relation(fields: [auctionId], references: [id])

  @@map("sponsorship_proofs")
}

enum DisputeStatus {
  OPEN
  ARBITRATION
  RESOLVED_REFUND
  RESOLVED_UPHELD

  @@map("dispute_status")
}

model Dispute {
  id              String        @id @default(cuid())
  auctionId       String        @map("auction_id")
  raisedBy        String        @map("raised_by")
  reason          String
  status          DisputeStatus @default(OPEN)
  resolutionNotes String?       @map("resolution_notes")
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  resolvedAt      DateTime?     @map("resolved_at") @db.Timestamptz(3)

  auction Auction @relation(fields: [auctionId], references: [id])

  @@index([auctionId, status])
  @@map("disputes")
}
```

Add the reverse relations to `Auction`:

```prisma
model Auction {
  // ...existing fields...
  sponsorshipProof SponsorshipProof?
  disputes         Dispute[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_sponsorship_proof_and_dispute`
Expected: applies cleanly.

- [ ] **Step 3: Write the failing `SponsorshipProofService` test**

```typescript
// src/proofs/sponsorship-proof.service.spec.ts
import { SponsorshipProofService } from './sponsorship-proof.service.js';
import { SponsorshipProofDb } from './sponsorship-proof.db.js';

describe('SponsorshipProofService', () => {
  describe('getByAuctionId', () => {
    describe('when a proof has been submitted', () => {
      it('returns it', async () => {
        const proof = { id: 'proof-1', auctionId: 'auction-1' };
        const db = { findByAuctionId: vi.fn().mockResolvedValue(proof) } as unknown as SponsorshipProofDb;
        const service = new SponsorshipProofService(db);

        const result = await service.getByAuctionId('auction-1');

        expect(result).toEqual(proof);
      });
    });

    describe('when no proof has been submitted', () => {
      it('returns null', async () => {
        const db = { findByAuctionId: vi.fn().mockResolvedValue(null) } as unknown as SponsorshipProofDb;
        const service = new SponsorshipProofService(db);

        const result = await service.getByAuctionId('auction-1');

        expect(result).toBeNull();
      });
    });
  });
});
```

- [ ] **Step 4: Write the failing `DisputeService` test**

```typescript
// src/disputes/dispute.service.spec.ts
import { DisputeService } from './dispute.service.js';
import { DisputeDb } from './dispute.db.js';

describe('DisputeService', () => {
  describe('hasOpenDispute', () => {
    describe('when an OPEN dispute exists for the auction', () => {
      it('returns true', async () => {
        const db = {
          findOpenForAuction: vi.fn().mockResolvedValue({ id: 'dispute-1', status: 'OPEN' }),
        } as unknown as DisputeDb;
        const service = new DisputeService(db);

        const result = await service.hasOpenDispute('auction-1');

        expect(result).toBe(true);
      });
    });

    describe('when no OPEN dispute exists for the auction', () => {
      it('returns false', async () => {
        const db = { findOpenForAuction: vi.fn().mockResolvedValue(null) } as unknown as DisputeDb;
        const service = new DisputeService(db);

        const result = await service.hasOpenDispute('auction-1');

        expect(result).toBe(false);
      });
    });
  });
});
```

- [ ] **Step 5: Run both tests to verify they fail**

Run: `npm test -- sponsorship-proof.service.spec.ts dispute.service.spec.ts`
Expected: FAIL.

- [ ] **Step 6: Implement `sponsorship-proof.db.ts` and `sponsorship-proof.service.ts`**

```typescript
// src/proofs/sponsorship-proof.db.ts
import { Injectable } from '@nestjs/common';
import { SponsorshipProof } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SponsorshipProofDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAuctionId(auctionId: string): Promise<SponsorshipProof | null> {
    return this.prisma.sponsorshipProof.findUnique({ where: { auctionId } });
  }
}
```

```typescript
// src/proofs/sponsorship-proof.service.ts
import { Injectable } from '@nestjs/common';
import { SponsorshipProof } from '@prisma/client';
import { SponsorshipProofDb } from './sponsorship-proof.db.js';

@Injectable()
export class SponsorshipProofService {
  constructor(private readonly db: SponsorshipProofDb) {}

  getByAuctionId(auctionId: string): Promise<SponsorshipProof | null> {
    return this.db.findByAuctionId(auctionId);
  }
}
```

- [ ] **Step 7: Implement `dispute.db.ts` and `dispute.service.ts`**

```typescript
// src/disputes/dispute.db.ts
import { Injectable } from '@nestjs/common';
import { Dispute } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DisputeDb {
  constructor(private readonly prisma: PrismaService) {}

  findOpenForAuction(auctionId: string): Promise<Dispute | null> {
    return this.prisma.dispute.findFirst({ where: { auctionId, status: 'OPEN' } });
  }
}
```

```typescript
// src/disputes/dispute.service.ts
import { Injectable } from '@nestjs/common';
import { DisputeDb } from './dispute.db.js';

@Injectable()
export class DisputeService {
  constructor(private readonly db: DisputeDb) {}

  async hasOpenDispute(auctionId: string): Promise<boolean> {
    const dispute = await this.db.findOpenForAuction(auctionId);

    return dispute !== null;
  }
}
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `npm test -- sponsorship-proof.service.spec.ts dispute.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Add `proofs.module.ts` and `disputes.module.ts`, wire both into `AppModule`**

```typescript
// src/proofs/proofs.module.ts
import { Module } from '@nestjs/common';
import { SponsorshipProofDb } from './sponsorship-proof.db.js';
import { SponsorshipProofService } from './sponsorship-proof.service.js';

@Module({
  providers: [SponsorshipProofService, SponsorshipProofDb],
  exports: [SponsorshipProofService],
})
export class ProofsModule {}
```

```typescript
// src/disputes/disputes.module.ts
import { Module } from '@nestjs/common';
import { DisputeDb } from './dispute.db.js';
import { DisputeService } from './dispute.service.js';

@Module({
  providers: [DisputeService, DisputeDb],
  exports: [DisputeService],
})
export class DisputesModule {}
```

Add `ProofsModule` and `DisputesModule` to `AppModule`'s `imports`.

- [ ] **Step 10: Verify lint, lint:arch, build, tests**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/proofs src/disputes src/app.module.ts
git commit -m "feat: add SponsorshipProof and Dispute models, proofs and disputes modules"
```

---

### Task 12: Strike and TrustScoreEvent models, trust module

**Files:**
- Modify: `prisma/schema.prisma`, `src/app.module.ts`
- Create: `src/trust/strike.db.ts`, `src/trust/trust-score-event.db.ts`, `src/trust/trust.service.ts`, `src/trust/trust.service.spec.ts`, `src/trust/trust.module.ts`

**Interfaces:**
- Consumes: `Athlete` model (Task 4).
- Produces: `StrikeDb.findActiveByAthlete(athleteId: string): Promise<Strike[]>`, `TrustScoreEventDb.findByAthlete(athleteId: string): Promise<TrustScoreEvent[]>`, `TrustService.getActiveStrikeCount(athleteId: string): Promise<number>`, `TrustService.getScoreHistory(athleteId: string): Promise<TrustScoreEvent[]>`.

- [ ] **Step 1: Add `Strike` and `TrustScoreEvent` models to `prisma/schema.prisma`**

```prisma
model Strike {
  id                  String   @id @default(cuid())
  athleteId           String   @map("athlete_id")
  reason              String
  triggeringAuctionId String?  @map("triggering_auction_id")
  excludedFromCount   Boolean? @map("excluded_from_count")
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  athlete Athlete @relation(fields: [athleteId], references: [id])

  @@index([athleteId])
  @@index([triggeringAuctionId])
  @@map("strikes")
}

model TrustScoreEvent {
  id        String   @id @default(cuid())
  athleteId String   @map("athlete_id")
  oldValue  Int      @map("old_value")
  newValue  Int      @map("new_value")
  reason    String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  athlete Athlete @relation(fields: [athleteId], references: [id])

  @@index([athleteId])
  @@map("trust_score_events")
}
```

`excludedFromCount` is reserved for future strike-expiry logic (see spec section 5.7) — no expiry logic is implemented in this ticket; it stays `null` for every row created here.

Add the reverse relations to `Athlete`:

```prisma
model Athlete {
  // ...existing fields...
  strikes          Strike[]
  trustScoreEvents TrustScoreEvent[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_strike_and_trust_score_event`
Expected: applies cleanly.

- [ ] **Step 3: Write the failing service test**

```typescript
// src/trust/trust.service.spec.ts
import { TrustService } from './trust.service.js';
import { StrikeDb } from './strike.db.js';
import { TrustScoreEventDb } from './trust-score-event.db.js';

describe('TrustService', () => {
  describe('getActiveStrikeCount', () => {
    describe('when the athlete has active strikes', () => {
      it('returns the count of strikes not excluded from counting', async () => {
        const strikeDb = {
          findActiveByAthlete: vi
            .fn()
            .mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
        } as unknown as StrikeDb;
        const trustScoreEventDb = {} as TrustScoreEventDb;
        const service = new TrustService(strikeDb, trustScoreEventDb);

        const result = await service.getActiveStrikeCount('athlete-1');

        expect(result).toBe(2);
      });
    });

    describe('when the athlete has no active strikes', () => {
      it('returns zero', async () => {
        const strikeDb = {
          findActiveByAthlete: vi.fn().mockResolvedValue([]),
        } as unknown as StrikeDb;
        const trustScoreEventDb = {} as TrustScoreEventDb;
        const service = new TrustService(strikeDb, trustScoreEventDb);

        const result = await service.getActiveStrikeCount('athlete-1');

        expect(result).toBe(0);
      });
    });
  });

  describe('getScoreHistory', () => {
    it('delegates to TrustScoreEventDb', async () => {
      const strikeDb = {} as StrikeDb;
      const events = [{ id: 'event-1', oldValue: 50, newValue: 45 }];
      const trustScoreEventDb = {
        findByAthlete: vi.fn().mockResolvedValue(events),
      } as unknown as TrustScoreEventDb;
      const service = new TrustService(strikeDb, trustScoreEventDb);

      const result = await service.getScoreHistory('athlete-1');

      expect(result).toEqual(events);
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- trust.service.spec.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `strike.db.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Strike } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class StrikeDb {
  constructor(private readonly prisma: PrismaService) {}

  findActiveByAthlete(athleteId: string): Promise<Strike[]> {
    return this.prisma.strike.findMany({
      where: { athleteId, excludedFromCount: { not: true } },
    });
  }
}
```

- [ ] **Step 6: Implement `trust-score-event.db.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { TrustScoreEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TrustScoreEventDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAthlete(athleteId: string): Promise<TrustScoreEvent[]> {
    return this.prisma.trustScoreEvent.findMany({
      where: { athleteId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
```

- [ ] **Step 7: Implement `trust.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { TrustScoreEvent } from '@prisma/client';
import { StrikeDb } from './strike.db.js';
import { TrustScoreEventDb } from './trust-score-event.db.js';

@Injectable()
export class TrustService {
  constructor(
    private readonly strikeDb: StrikeDb,
    private readonly trustScoreEventDb: TrustScoreEventDb,
  ) {}

  async getActiveStrikeCount(athleteId: string): Promise<number> {
    const strikes = await this.strikeDb.findActiveByAthlete(athleteId);

    return strikes.length;
  }

  getScoreHistory(athleteId: string): Promise<TrustScoreEvent[]> {
    return this.trustScoreEventDb.findByAthlete(athleteId);
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- trust.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Add `trust.module.ts` and wire into `AppModule`**

```typescript
// src/trust/trust.module.ts
import { Module } from '@nestjs/common';
import { StrikeDb } from './strike.db.js';
import { TrustScoreEventDb } from './trust-score-event.db.js';
import { TrustService } from './trust.service.js';

@Module({
  providers: [TrustService, StrikeDb, TrustScoreEventDb],
  exports: [TrustService],
})
export class TrustModule {}
```

Add `TrustModule` to `AppModule`'s `imports`.

- [ ] **Step 10: Verify lint, lint:arch, build, tests**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/trust src/app.module.ts
git commit -m "feat: add Strike and TrustScoreEvent models, trust module"
```

---

### Task 13: Final wiring, full-suite verification, and README

**Files:**
- Modify: `src/app.module.ts` (verify final import list)
- Create: `README.md`

**Interfaces:**
- Consumes: all modules from Tasks 4-12.
- Produces: nothing new — this task is a full-system checkpoint.

- [ ] **Step 1: Verify `src/app.module.ts` imports every feature module**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AthletesModule } from './athletes/athletes.module.js';
import { BiddersModule } from './bidders/bidders.module.js';
import { ZonesModule } from './zones/zones.module.js';
import { RacesModule } from './races/races.module.js';
import { AuctionsModule } from './auctions/auctions.module.js';
import { BidsModule } from './bids/bids.module.js';
import { EscrowModule } from './escrow/escrow.module.js';
import { ProofsModule } from './proofs/proofs.module.js';
import { DisputesModule } from './disputes/disputes.module.js';
import { TrustModule } from './trust/trust.module.js';

@Module({
  imports: [
    PrismaModule,
    AthletesModule,
    BiddersModule,
    ZonesModule,
    RacesModule,
    AuctionsModule,
    BidsModule,
    EscrowModule,
    ProofsModule,
    DisputesModule,
    TrustModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Full clean-slate migration check**

Run: `docker compose down -v && docker compose up -d postgres && sleep 2 && npx prisma migrate deploy`
Expected: every migration from Tasks 4-12 applies in order against a fresh database with no errors — this proves the migration history is self-consistent end to end, not just incrementally correct.

- [ ] **Step 3: Full verification pass**

Run: `npm run lint && npm run lint:arch && npm run build && npm test`
Expected: all pass, zero failures across every module's spec file.

- [ ] **Step 4: Add a short `README.md`**

```markdown
# Hyrox Sponsor — Backend

NestJS + Prisma + PostgreSQL. See `docs/specs/2026-09-28-core-data-model-design.md`
for the data model design.

## Local development

1. Copy `.env.example` to `.env`.
2. `docker compose up -d postgres`
3. `npm install`
4. `npx prisma migrate deploy`
5. `npm run build && npm run lint && npm run lint:arch && npm test`
```

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts README.md
git commit -m "chore: finalize module wiring, verify full migration/test suite, add README"
```

---

## Self-Review Notes

- **Spec coverage:** every entity in spec section 5 (BodyZone, Athlete, Bidder, ZoneFloorPrice, Race, RaceEntry, Auction, Bid, EscrowTransaction, SponsorshipProof, Dispute, Strike, TrustScoreEvent) has a task. The partial unique leading-bid index, the $10 floor-price check constraint, the same-day RaceEntry unique index on `(athleteId, raceLocalDate)`, `status`/`outcome` split on Auction, and `commissionCents`/`processingFeeCents` are all present. dependency-cruiser enforcement (coordinator addition) is Task 3. Stack scaffold and migration mechanics are Tasks 1-2 and 13.
- **Out of scope confirmed absent:** no controllers, no Stripe SDK calls, no auth, no bid-placement/increment-validation logic, no scheduling job, no row-locking transaction code (explicitly deferred per spec section 7, item 11) — matches spec section 8.
- **Type consistency:** `AthleteDb`/`AthleteService`, `BidderDb`/`BidderService`, etc. method names and signatures used in later "Consumes" blocks match the "Produces" blocks of the tasks that define them.
