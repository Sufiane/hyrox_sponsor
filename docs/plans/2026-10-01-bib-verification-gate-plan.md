# HYR-6: Bib/Confirmation Upload and Verification Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let athletes upload a bib/confirmation document (and bib number) for a race entry, build the backend capabilities staff review needs, and expose a service-level verification gate that HYR-8 checks before any auction is created or opened.

**Architecture:** Uploads go through the API (multer memory storage, magic-byte sniffing) into a private S3-compatible bucket behind a `DocumentStorage` port; only the object key is stored on `RaceEntry`. Submit and review are usecases under `src/races/usecases/` (each with its own narrow db and Nest module, like `LogRaceModule`) using compare-and-set updates; simple reads and the gate stay on `RaceEntryService`/`RaceEntryDb`. Two athlete endpoints sit behind HYR-3's `JwtAuthGuard`. Staff auth and the staff API are HYR-29, not this ticket. The gate is service-level only (no DB trigger).

**Tech Stack:** NestJS 12, Prisma 6.19.3, Postgres 16, Vitest 5 + `vitest-mock-extended`, `@aws-sdk/client-s3`, MinIO for local dev.

**Spec:** `docs/specs/2026-10-01-bib-verification-gate-design.md` (read sections 1 to 4 first).

## Global Constraints

Repo state this plan is written against: `main` at `9e1dbb8` (HYR-2, HYR-3, HYR-5 and bidders merged, branch rebased). Real identifiers to use:

- Auth (HYR-3): `JwtAuthGuard` in `src/auth/jwt-auth.guard.ts`; `CurrentAthleteId` decorator in `src/auth/current-athlete-id.decorator.ts` returning `AthleteId | undefined`; `AuthModule` (exports `JwtAuthGuard`, `TokenService`). Global `createValidationPipe()` (`src/common/validation-pipe.ts`, DTO failures become `BadRequestException('validation_failed')`), CORS and throttler already wired; do not add them again.
- Errors: use `InvalidValueError` (400), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409) from `src/common/domain-error.ts`, mapped by the global `DomainErrorFilter`. Do not throw Nest HTTP exceptions from services/usecases. Only the controller's impossible-undefined narrowing uses `UnauthorizedException('invalid_token')` (same code the guard uses).
- Config: env goes through `@nestjs/config` (`ConfigService<EnvironmentVariables, true>`, `src/config/env.validation.ts`), not `process.env`.
- Races (HYR-5): `RaceEntryService` constructor is `(db: RaceEntryDb, logRaceUsecase: LogRaceUsecase)`; entries are created by `POST /athletes/:athleteId/race-entries` with `bibNumber = null`, status `PENDING`. `RaceEntryId` type already exists in `src/common/ids.ts`; only `athleteId()` has a constructor so far. Each usecase has its own module (`LogRaceModule`); `RacesModule` imports them.
- Latest migration is `prisma/migrations/20261003100000_add_race_entry_division_and_race_name_key`; ours must sort after it.

Project constraints (CLAUDE.md and repo conventions, verbatim essentials):

- Exact-pinned dependencies (install, then strip `^`/`~`, matching `package-lock.json`).
- Explicit return type on every function/method; no single-letter names (except `i/j/k` in indexed `for`); no inline `if`; blank line before `if/for/while/return/throw` unless first in block; no `!!x`; no nested function declarations; delete dead code; constructor-injected deps `private readonly`.
- Numeric separators on numeric literals of 5+ digits (`10_485_760`, `2_592_000`); 4 digits or fewer plain.
- `*.service.ts` and `*.usecase.ts` never import `@prisma/client` or `src/prisma/*` (dependency-cruiser enforces). Local `as const` status objects, no Prisma enums in services/usecases.
- Casts to a brand only in `*.db.ts`, the S3 adapter and `src/common` constructors. Free-text fields (bib number, rejection reason) are not branded. Signatures with two or more same-typed params use brands or an object parameter.
- Errors are snake_case codes; readable detail with ids goes to the class `Logger` (`warn`) at the throw site. `src/common` helpers throw only a domain error with a code and never log.
- No barrel files. Relative imports have no `.js` extension (build uses `tsc-alias`).
- Columns snake_case via `@map`; `DateTime` is `@db.Timestamptz(3)`. No trigger and no hand-written SQL except the column rename in Task 1.
- Comments only for a non-obvious why.
- Tests: nested `describe` per condition (`when ...`), short `it` titles, shared setup in that `describe`'s `beforeEach`; services/usecases use `Test.createTestingModule` with `mockDeep` providers, controllers are instantiated directly like `race-entry.controller.spec.ts`.
- Git: stage each task's files with `git add`, do NOT commit; the user reviews the staged diff with `/crit` first (CLAUDE.md "review before commit"). Commit messages and PR titles are Conventional Commits (`type(scope): lowercase imperative summary`). Rename the branch (currently `cairo/hyr-6-handle`) to `hyr-06` BEFORE pushing or opening a PR, never after a PR exists.
- Linear HYR-6: move to In Progress when the build starts (check current state first so it never moves backwards), to In Review only once everything is staged and ready for `/crit`.
- Gate for every task that changes code: `npm run lint`, `npm run lint:arch`, `npm test`, `npm run build` pass.

## Task Dependencies

Tasks 1, 2 and 3 are independent of each other. Task 4 needs 1 and 2. Task 5 needs 1 to 4. Task 6 needs 1, 2 and 4 (run after 5 because both edit `race-entry.service.ts`, `race-entry.service.spec.ts` and `races.module.ts`). Task 7 needs 4 and 5. Task 8 is last. Everything is backend; there is no frontend work in this plan.

## File Structure

```
prisma/schema.prisma                                       modify (Task 1)
prisma/migrations/20261003110000_race_entry_verification/migration.sql   create (Task 1)
src/common/ids.ts (+ ids.spec.ts)                          modify: raceEntryId(), StaffId, staffId() (Task 2)
src/common/document-key.ts (+ .spec.ts)                    create (Task 2)
src/common/document-sniffer.ts (+ .spec.ts)                create (Task 2)
src/config/env.validation.ts (+ .spec.ts)                  modify: STORAGE_* vars (Task 3)
src/storage/document-storage.ts                            create (Task 3)
src/storage/s3-document-storage.ts                         create (Task 3)
src/storage/storage.module.ts                              create (Task 3)
.dependency-cruiser.cjs, docker-compose.yml, .env.example  modify (Task 3)
src/races/race-entry.db.ts                                 modify (Task 4)
src/races/race-entry.service.ts (+ .spec.ts)               modify (Tasks 4, 5, 6)
src/races/usecases/submit-verification-document/*          create (Task 5)
src/races/usecases/review-verification/*                   create (Task 6)
src/races/dto/race-entry-params.dto.ts (+ .spec.ts)        create (Task 7)
src/races/dto/submit-verification.dto.ts (+ .spec.ts)      create (Task 7)
src/races/race-entry-verification.controller.ts (+ .spec)  create (Task 7)
src/races/races.module.ts                                  modify (Tasks 4 to 7)
README.md and two HYR-2 doc pointers                       modify (Task 8)
```

`src/main.ts` and `src/app.module.ts` are not modified.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (the `RaceEntry` model)
- Create: `prisma/migrations/20261003110000_race_entry_verification/migration.sql`

**Interfaces:**
- Produces: Prisma fields `RaceEntry.verificationDocumentKey: string | null`, `verificationSubmittedAt: Date | null`, `verificationRejectionReason: string | null`; index on `(verificationStatus, verificationSubmittedAt)`. `bibNumber` is already `String?`.

- [ ] **Step 1: Edit the schema**

In `RaceEntry`, replace the `verificationDocumentUrl` line and add the new fields and index:

```prisma
  verificationDocumentKey     String?                     @map("verification_document_key")
  verificationSubmittedAt     DateTime?                   @map("verification_submitted_at") @db.Timestamptz(3)
  verificationRejectionReason String?                     @map("verification_rejection_reason")
```

Add `@@index([verificationStatus, verificationSubmittedAt])` beside the existing `@@index([raceId])`.

- [ ] **Step 2: Produce the SQL with the README shadow-database command**

`prisma migrate dev --create-only` does not run non-interactively, so generate the SQL with `migrate diff` against a scratch shadow database (README "Sanity check" section; port 5435 may be held by another workspace's postgres, in which case use a throwaway container on another port and never touch other projects' containers):

```sh
docker compose exec postgres psql -U hyrox -d postgres -c "CREATE DATABASE shadow_check"
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://hyrox:hyrox@localhost:5435/shadow_check?schema=public" --script
docker compose exec postgres psql -U hyrox -d postgres -c "DROP DATABASE shadow_check"
```

- [ ] **Step 3: Write the migration file**

Create `prisma/migrations/20261003110000_race_entry_verification/migration.sql` from the diff output, replacing the generated `DROP COLUMN verification_document_url` plus `ADD COLUMN verification_document_key` with a rename so data is preserved, and removing any `DROP` of the existing hand-written CHECK/partial index:

```sql
ALTER TABLE "race_entries" RENAME COLUMN "verification_document_url" TO "verification_document_key";
```

Keep the generated `ADD COLUMN verification_submitted_at`, `ADD COLUMN verification_rejection_reason` and `CREATE INDEX` statements. This rename is the only hand-written SQL in the ticket.

- [ ] **Step 4: Apply and verify**

Run: `npx prisma migrate dev && npx prisma generate`, then re-run the Step 2 diff; expected output `-- This is an empty migration.`. Then `npm run lint && npm run lint:arch && npm test && npm run build`. Expected: pass.
Stage: `git add prisma`

---

### Task 2: Common helpers (ids, document key, magic-byte sniffer)

**Files:**
- Modify: `src/common/ids.ts`, `src/common/ids.spec.ts`
- Create: `src/common/document-key.ts`, `src/common/document-key.spec.ts`, `src/common/document-sniffer.ts`, `src/common/document-sniffer.spec.ts`

**Interfaces:**
- Consumes: `Brand`, `InvalidValueError`, existing `RaceEntryId` type and `athleteId()` pattern.
- Produces:
  - `raceEntryId(value: string): RaceEntryId` (trim, 1 to 64 chars, else `InvalidValueError('race_entry_id_invalid')`).
  - `type StaffId = Brand<string, 'StaffId'>`, `staffId(value: string): StaffId` (trim, 1 to 64 chars, else `InvalidValueError('staff_id_invalid')`).
  - In `document-key.ts`: `type DocumentExtension = 'jpg' | 'png' | 'webp' | 'pdf'`, `type DocumentKey`, `const DOCUMENT_KEY_PATTERN: RegExp`, `documentKey(value: string): DocumentKey` (`InvalidValueError('document_key_invalid')`), `buildDocumentKey(raceEntryId: RaceEntryId, extension: DocumentExtension): DocumentKey`.
  - In `document-sniffer.ts`: `type DetectedDocument = { extension: DocumentExtension; contentType: string }`, `detectDocumentType(buffer: Buffer): DetectedDocument | null`.

- [ ] **Step 1: Write failing specs**

Extend `ids.spec.ts` with `describe('raceEntryId', ...)` and `describe('staffId', ...)` mirroring the existing `athleteId` spec (trimmed value returned; blank throws `InvalidValueError` with the code; 65 characters throws the code).

`document-key.spec.ts` (plain Vitest):

```ts
import { InvalidValueError } from './domain-error';
import { buildDocumentKey, documentKey } from './document-key';
import type { RaceEntryId } from './ids';

describe('documentKey', () => {
  describe('when the value has the expected shape', () => {
    it('returns the key', () => {
      const value = 'race-entries/abc123/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf';

      expect(documentKey(value)).toBe(value);
    });
  });

  describe('when the value is malformed', () => {
    it.each(['', 'race-entries/abc/../x.pdf', 'other/abc/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf', 'race-entries/abc/x.exe'])(
      'throws InvalidValueError for %s',
      (value) => {
        expect(() => documentKey(value)).toThrow(InvalidValueError);
        expect(() => documentKey(value)).toThrow('document_key_invalid');
      },
    );
  });
});

describe('buildDocumentKey', () => {
  it('builds a valid key under the race entry prefix', () => {
    const key = buildDocumentKey('entry1' as RaceEntryId, 'png');

    expect(key.startsWith('race-entries/entry1/')).toBe(true);
    expect(key.endsWith('.png')).toBe(true);
    expect(() => documentKey(key)).not.toThrow();
  });
});
```

`document-sniffer.spec.ts`: table-driven. JPEG (`ff d8 ff e0 ...`), PNG (`89 50 4e 47 0d 0a 1a 0a`), WebP (`RIFF` + 4 size bytes + `WEBP`), PDF (`%PDF-1.7`) return the expected `extension` and `contentType` (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`); `null` for `MZ...`, an empty Buffer and a 3-byte buffer.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/common`. Expected: FAIL (new exports missing).

- [ ] **Step 3: Implement**

`ids.ts` (below `athleteId`; extract the shared trim/length check into a private function to avoid triple duplication, keeping `athleteId` behavior and code unchanged):

```ts
export type StaffId = Brand<string, 'StaffId'>;

export function raceEntryId(value: string): RaceEntryId {
  return validatedId(value, 'race_entry_id_invalid') as RaceEntryId;
}

export function staffId(value: string): StaffId {
  return validatedId(value, 'staff_id_invalid') as StaffId;
}
```

with `function validatedId(value: string, code: string): string` holding the existing trim/blank/`ID_MAX_LENGTH` logic and throwing `new InvalidValueError(code)`; refactor `athleteId` onto it.

`document-key.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';
import type { RaceEntryId } from './ids';

export type DocumentKey = Brand<string, 'DocumentKey'>;
export type DocumentExtension = 'jpg' | 'png' | 'webp' | 'pdf';

export const DOCUMENT_KEY_PATTERN = /^race-entries\/[a-z0-9]+\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export function documentKey(value: string): DocumentKey {
  if (!DOCUMENT_KEY_PATTERN.test(value)) {
    throw new InvalidValueError('document_key_invalid');
  }

  return value as DocumentKey;
}

export function buildDocumentKey(raceEntryId: RaceEntryId, extension: DocumentExtension): DocumentKey {
  return documentKey(`race-entries/${raceEntryId}/${randomUUID()}.${extension}`);
}
```

`document-sniffer.ts`: compare `buffer.subarray(0, n)` with signature byte arrays via `Buffer.from([...]).equals(...)`; WebP also checks `subarray(0, 4).toString('ascii') === 'RIFF'` and `subarray(8, 12).toString('ascii') === 'WEBP'`; PDF checks `subarray(0, 5).toString('ascii') === '%PDF-'`.

- [ ] **Step 4: Run to verify pass, check, stage**

Run: `npx vitest run src/common && npm run lint && npm run lint:arch`. Stage: `git add src/common`.

---

### Task 3: Storage port, S3 adapter, env config, dev infra

**Files:**
- Create: `src/storage/document-storage.ts`, `src/storage/s3-document-storage.ts`, `src/storage/storage.module.ts`
- Modify: `src/config/env.validation.ts`, `src/config/env.validation.spec.ts`, `.dependency-cruiser.cjs`, `docker-compose.yml`, `.env.example`, `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: `DocumentKey` (Task 2, type only), `EnvironmentVariables`.
- Produces:
  - `abstract class DocumentStorage { put(key: DocumentKey, body: Buffer, contentType: string): Promise<void>; delete(key: DocumentKey): Promise<void>; signedGetUrl(key: DocumentKey, expiresInSeconds: number): Promise<string>; }` (all abstract).
  - `StorageModule` providing and exporting `DocumentStorage` bound to `S3DocumentStorage`.
  - `EnvironmentVariables` gains `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` (required non-empty strings) and `STORAGE_ENDPOINT?: string` (optional URL).

- [ ] **Step 1: Failing env spec**

In `env.validation.spec.ts`, add the four required storage vars to `validEnv` (otherwise every existing test starts failing), then add: `describe('when a storage variable is missing', ...)` asserting `validateEnv` throws `env_invalid` for each required one (use `it.each`); `describe('when STORAGE_ENDPOINT is set', ...)` returns it; `describe('when STORAGE_ENDPOINT is absent', ...)` leaves it undefined. Run `npx vitest run src/config`; expected: FAIL.

- [ ] **Step 2: Implement env vars**

In `EnvironmentVariables`: `@IsString() @MinLength(1)` on the four required vars (`!:` definite assignment, matching the existing style) and `@IsOptional() @IsUrl({ require_tld: false }) STORAGE_ENDPOINT?: string;`. Run the spec again; expected: PASS.

- [ ] **Step 3: Install and pin dependencies**

Run: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner && npm install -D @types/multer`, then rewrite all three entries in `package.json` to the exact installed versions from `package-lock.json` (no caret).

- [ ] **Step 4: Port, adapter, module**

`document-storage.ts` is the abstract class above. `s3-document-storage.ts`: `@Injectable() export class S3DocumentStorage extends DocumentStorage`; the constructor takes `private readonly config: ConfigService<EnvironmentVariables, true>` and builds one `S3Client` (`region`, `endpoint` when set, `forcePathStyle: endpoint != null`, `credentials`); store the bucket name in a `private readonly bucket`. `put` sends `PutObjectCommand` (`Bucket`, `Key`, `Body`, `ContentType`, `ContentDisposition: 'attachment'`); `delete` sends `DeleteObjectCommand`; `signedGetUrl` uses `getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn })`. This is the only file importing `@aws-sdk/*`; it has no unit test (thin SDK wrapper, exercised in QA against MinIO). `storage.module.ts`:

```ts
@Module({
  providers: [{ provide: DocumentStorage, useClass: S3DocumentStorage }],
  exports: [DocumentStorage],
})
export class StorageModule {}
```

(`ConfigModule` is global, no import needed.)

- [ ] **Step 5: Boundary rule and dev infra**

`.dependency-cruiser.cjs`: add forbidden rule `no-aws-sdk-outside-storage-adapter`, `from: { path: '^src/', pathNot: '^src/storage/s3-document-storage\\.ts$' }`, `to: { path: 'node_modules/@aws-sdk' }`, severity `error`. `docker-compose.yml`: add a `minio` service (`minio/minio`, `command: server /data --console-address ":9006"`, ports `9005:9000` and `9006:9001`, user/password `hyrox`/`hyrox-secret`, volume `hyrox_minio_data`); check the ports first with `lsof -i :9005 -i :9006` and pick free ones if taken. `.env.example`: append `STORAGE_ENDPOINT=http://localhost:9005`, `STORAGE_REGION=us-east-1`, `STORAGE_BUCKET=hyrox-verification-docs`, `STORAGE_ACCESS_KEY_ID=hyrox`, `STORAGE_SECRET_ACCESS_KEY=hyrox-secret` (no quotes, matching the file's existing HYR-3 lines). The bucket is created once in the MinIO console (documented in Task 8).

- [ ] **Step 6: Check and stage**

Run: `npm run lint && npm run lint:arch && npm test && npm run build`. Prove the rule works by temporarily importing `@aws-sdk/client-s3` in `src/races/race-entry.service.ts`, seeing `lint:arch` fail, then reverting.
Stage: `git add src/storage src/config .dependency-cruiser.cjs docker-compose.yml .env.example package.json package-lock.json`

---

### Task 4: RaceEntry gate, status view, queue and signed URL (service + db)

**Files:**
- Modify: `src/races/race-entry.db.ts`, `src/races/race-entry.service.ts`, `src/races/race-entry.service.spec.ts`, `src/races/races.module.ts` (import `StorageModule`)

**Interfaces:**
- Consumes: `RaceEntryId`, `AthleteId`, `DocumentKey`/`documentKey` (Task 2), `DocumentStorage` (Task 3), `NotFoundError`, `ConflictError`.
- Produces in `RaceEntryDb`:
  - `findById(id: RaceEntryId): Promise<RaceEntry | null>`
  - `findDocumentKeyById(id: RaceEntryId): Promise<{ documentKey: DocumentKey | null } | null>`
  - `listAwaitingReview(limit: number): Promise<AwaitingReviewRecord[]>`, `export type AwaitingReviewRecord = RaceEntry & { athlete: { id: string; name: string }; race: { id: string; name: string } }`, filtered `verificationStatus = PENDING AND verificationDocumentKey != null`, ordered `verificationSubmittedAt asc`.
- Produces in `RaceEntryService` (constructor becomes `(db, logRaceUsecase, storage: DocumentStorage)`; later tasks append usecases):
  - `assertVerified(raceEntryId: RaceEntryId): Promise<void>` (`NotFoundError('race_entry_not_found')`, `ConflictError('race_entry_not_verified')`)
  - `isVerifiedById(raceEntryId: RaceEntryId): Promise<boolean>`
  - `getVerificationStatus(athleteId: AthleteId, raceEntryId: RaceEntryId): Promise<VerificationStatusView>` (`NotFoundError('race_entry_not_found')` when missing or not owned)
  - `listAwaitingReview(): Promise<AwaitingReviewItem[]>` (limit 50)
  - `getDocumentAccess(raceEntryId: RaceEntryId): Promise<{ url: string; expiresAt: Date; documentKey: DocumentKey }>` (`NotFoundError('race_entry_not_found')` / `NotFoundError('verification_document_not_found')`; TTL 300 seconds)
  - exported types `VerificationStatusView = { raceEntryId: RaceEntryId; verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'; bibNumber: string | null; hasDocument: boolean; rejectionReason: string | null; submittedAt: Date | null; reviewedAt: Date | null }` and `AwaitingReviewItem = { raceEntryId: string; athleteId: string; athleteName: string; raceId: string; raceName: string; raceDate: Date; bibNumber: string | null; documentKey: string; submittedAt: Date }`.

- [ ] **Step 1: Write failing service specs**

Extend `race-entry.service.spec.ts`: add `storage = mockDeep<DocumentStorage>()` and `{ provide: DocumentStorage, useValue: storage }` to the module providers; keep the existing `isVerified` tests and the `logRace` delegation test. Add nested `describe`s with `vi.spyOn(Logger.prototype, 'warn')` asserted on every not-found/conflict path:

- `assertVerified` (the gate; the only enforcement of the invariant, so cover every status in its own `describe`): missing entry -> `NotFoundError('race_entry_not_found')` and warn log with the id; `VERIFIED` -> resolves; `PENDING` -> `ConflictError('race_entry_not_verified')` + warn; `REJECTED` -> same.
- `isVerifiedById`: missing -> false; `VERIFIED` -> true; `PENDING` -> false; `REJECTED` -> false (one `describe` each).
- `getVerificationStatus`: entry owned by another athlete -> `NotFoundError('race_entry_not_found')`; owner -> view with `hasDocument` true iff `verificationDocumentKey != null`, `bibNumber`, `rejectionReason`, `submittedAt`, `reviewedAt = verifiedAt`; `expect(view).not.toHaveProperty('documentKey')`.
- `listAwaitingReview`: calls `db.listAwaitingReview(50)` and maps records; records with a null key or null `verificationSubmittedAt` are skipped.
- `getDocumentAccess`: entry missing -> `race_entry_not_found`; key null -> `verification_document_not_found`; present -> `storage.signedGetUrl(key, 300)` called, returns `{ url, expiresAt, documentKey }` with `expiresAt` = now + 300 s (`vi.useFakeTimers()` + `vi.setSystemTime` in that `describe`'s `beforeEach`, `vi.useRealTimers()` in `afterEach`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/races/race-entry.service.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement db methods**

```ts
findById(id: RaceEntryId): Promise<RaceEntry | null> {
  return this.prisma.raceEntry.findUnique({ where: { id } });
}

async findDocumentKeyById(id: RaceEntryId): Promise<{ documentKey: DocumentKey | null } | null> {
  const entry = await this.prisma.raceEntry.findUnique({
    where: { id },
    select: { verificationDocumentKey: true },
  });

  if (!entry) {
    return null;
  }

  const stored = entry.verificationDocumentKey;

  return { documentKey: stored == null ? null : documentKey(stored) };
}

listAwaitingReview(limit: number): Promise<AwaitingReviewRecord[]> {
  return this.prisma.raceEntry.findMany({
    where: { verificationStatus: 'PENDING', verificationDocumentKey: { not: null } },
    orderBy: { verificationSubmittedAt: 'asc' },
    take: limit,
    include: { athlete: { select: { id: true, name: true } }, race: { select: { id: true, name: true } } },
  });
}
```

- [ ] **Step 4: Implement service methods**

Add `private readonly logger = new Logger(RaceEntryService.name)`, constants `DOCUMENT_URL_TTL_SECONDS = 300` and `AWAITING_REVIEW_LIMIT = 50`; inject `DocumentStorage`. Implement per Interfaces. `VerificationStatusView.raceEntryId` comes from the already-branded argument. In `listAwaitingReview` use `.flatMap` to skip records whose key or `verificationSubmittedAt` is null (satisfies the types without a cast). Import `StorageModule` in `RacesModule`.

- [ ] **Step 5: Run to verify pass, check, stage**

Run: `npx vitest run src/races && npm run lint && npm run lint:arch && npm run build`. Stage: `git add src/races`.

---

### Task 5: Submit-verification-document usecase

**Files:**
- Create: `src/races/usecases/submit-verification-document/submit-verification-document.usecase.ts`, `.usecase.db.ts`, `.module.ts`, `.usecase.spec.ts`
- Modify: `src/races/race-entry.service.ts`, `src/races/race-entry.service.spec.ts`, `src/races/races.module.ts`

**Interfaces:**
- Consumes: `RaceEntryId`, `AthleteId`, `buildDocumentKey`, `detectDocumentType`, `DocumentKey`, `DocumentStorage`, domain errors.
- Produces:
  - `SubmitVerificationDocumentUsecaseDb`:
    - `findForSubmission(id: RaceEntryId): Promise<SubmissionRecord | null>`, `SubmissionRecord = { athleteId: string; raceDate: Date; verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'; verificationDocumentKey: DocumentKey | null; athleteIsBanned: boolean }`
    - `markSubmitted(input: MarkSubmittedInput): Promise<number>`, `MarkSubmittedInput = { raceEntryId: RaceEntryId; previousKey: DocumentKey | null; newKey: DocumentKey; bibNumber: string; at: Date }`, returns the updated row count.
  - `SubmitVerificationDocumentUsecase.execute(input: SubmitVerificationDocumentInput): Promise<SubmitVerificationDocumentResult>` with `SubmitVerificationDocumentInput = { athleteId: AthleteId; raceEntryId: RaceEntryId; bibNumber: string; file: Buffer }` and `SubmitVerificationDocumentResult = { submittedAt: Date; verificationStatus: 'PENDING' }`.
  - `SubmitVerificationDocumentModule` (providers: usecase + db; imports `StorageModule`; exports the usecase).
  - `RaceEntryService.submitVerificationDocument(input: SubmitVerificationDocumentInput): Promise<SubmitVerificationDocumentResult>`, a thin delegate.

Rules (spec 4.2; each error logs a warn line with ids): `NotFoundError('race_entry_not_found')` (missing or `athleteId` mismatch); `ForbiddenError('athlete_banned')`; `ConflictError('race_entry_already_verified')`; `ConflictError('race_already_started')` when `raceDate <= now`; `InvalidValueError('document_missing')` (empty buffer), `InvalidValueError('document_too_large')` (> `MAX_DOCUMENT_BYTES = 10_485_760`), `InvalidValueError('document_type_unsupported')` (sniffer null). Order: ownership, banned, verified, race started, then file validation, so a non-owner never learns the file rules. CAS miss -> delete the new object, `ConflictError('verification_state_changed')`. Unexpected db error -> delete the new object best effort and rethrow. After success, delete `previousKey` best effort (warn on failure, never throw).

- [ ] **Step 1: Write failing usecase spec**

`Test.createTestingModule` with `{ provide: SubmitVerificationDocumentUsecaseDb, useValue: mockDeep<...>() }` and `{ provide: DocumentStorage, useValue: mockDeep<DocumentStorage>() }`. Fixtures: `const pdf = Buffer.from('%PDF-1.7 test')`, `const exe = Buffer.from('MZ test')`, fake timers at `2026-10-03T12:00:00Z`, `raceDate` `2027-03-01`. One nested `describe` per condition; each `it` asserts the error class and code (`toThrow(ConflictError)` then `toThrow('race_already_started')`, as in `log-race.usecase.spec.ts`) and whether `storage.put` was called:
- entry missing / owned by another athlete (both `NotFoundError`, no storage call)
- athlete banned; entry VERIFIED; race date passed
- empty file; file of `10_485_760 + 1` bytes; unsupported type
- PENDING entry, no document, PDF: `storage.put` once with a key matching `DOCUMENT_KEY_PATTERN` and `application/pdf`; `markSubmitted` called with `previousKey: null`, the `bibNumber` and `at` = now; resolves `{ submittedAt: now, verificationStatus: 'PENDING' }`; `storage.delete` not called
- REJECTED entry that had a document: after success `storage.delete(previousKey)` called
- deleting the old object fails: still resolves, a warn is logged
- `markSubmitted` returns 0: `ConflictError('verification_state_changed')` and `storage.delete(newKey)` called
- `markSubmitted` throws: same error rethrown and `storage.delete(newKey)` called

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/races/usecases/submit-verification-document`. Expected: FAIL.

- [ ] **Step 3: Implement the usecase db**

`@Injectable()` class, `constructor(private readonly prisma: PrismaService)`, the only ORM file in the folder:

```ts
async findForSubmission(id: RaceEntryId): Promise<SubmissionRecord | null> {
  const entry = await this.prisma.raceEntry.findUnique({
    where: { id },
    select: {
      athleteId: true,
      raceDate: true,
      verificationStatus: true,
      verificationDocumentKey: true,
      athlete: { select: { isBanned: true } },
    },
  });

  if (!entry) {
    return null;
  }

  return {
    athleteId: entry.athleteId,
    raceDate: entry.raceDate,
    verificationStatus: entry.verificationStatus,
    verificationDocumentKey: entry.verificationDocumentKey == null ? null : documentKey(entry.verificationDocumentKey),
    athleteIsBanned: entry.athlete.isBanned,
  };
}

async markSubmitted(input: MarkSubmittedInput): Promise<number> {
  const result = await this.prisma.raceEntry.updateMany({
    where: {
      id: input.raceEntryId,
      verificationStatus: { in: ['PENDING', 'REJECTED'] },
      verificationDocumentKey: input.previousKey,
    },
    data: {
      verificationStatus: 'PENDING',
      verificationDocumentKey: input.newKey,
      bibNumber: input.bibNumber,
      verificationSubmittedAt: input.at,
      verifiedAt: null,
      verifiedBy: null,
      verificationRejectionReason: null,
    },
  });

  return result.count;
}
```

Export `SubmissionRecord` and `MarkSubmittedInput` from the db file. Matching on `previousKey` makes a concurrent double upload, or an approve between read and write, miss the CAS.

- [ ] **Step 4: Implement usecase, module, delegate**

`@Injectable()` usecase with `private readonly logger = new Logger(SubmitVerificationDocumentUsecase.name)`, constructor `(private readonly db: SubmitVerificationDocumentUsecaseDb, private readonly storage: DocumentStorage)`, a local `VERIFICATION_STATUS` `as const`. Flow per Rules; `detectDocumentType` then `buildDocumentKey(input.raceEntryId, detected.extension)`; try/catch (`catch (error)`) around `markSubmitted` for cleanup-and-rethrow. Keep `execute` short with private methods `assertEligible`, `assertValidFile`, `deleteQuietly(key)`. Create `SubmitVerificationDocumentModule` and import it in `RacesModule`. Add `submitVerificationDocument` to `RaceEntryService` (inject the usecase, new constructor param), update the service spec providers with `{ provide: SubmitVerificationDocumentUsecase, useValue: mockDeep<...>() }` and add one delegation test.

- [ ] **Step 5: Run to verify pass, check, stage**

Run: `npx vitest run src/races && npm run lint && npm run lint:arch && npm run build`. Stage: `git add src/races`.

---

### Task 6: Review-verification usecase (approve/reject; consumed by HYR-29)

**Files:**
- Create: `src/races/usecases/review-verification/review-verification.usecase.ts`, `.usecase.db.ts`, `.module.ts`, `.usecase.spec.ts`
- Modify: `src/races/race-entry.service.ts`, `src/races/race-entry.service.spec.ts`, `src/races/races.module.ts`

**Interfaces:**
- Consumes: `RaceEntryId`, `DocumentKey`, `StaffId` (Task 2), domain errors.
- Produces:
  - `ReviewVerificationUsecaseDb`:
    - `markReviewed(input: { raceEntryId: RaceEntryId; expectedDocumentKey: DocumentKey; decision: 'VERIFIED' | 'REJECTED'; reviewerId: StaffId; rejectionReason: string | null; at: Date }): Promise<number>` (CAS count; `reviewerId` is written to the plain `verifiedBy` column)
    - `findState(id: RaceEntryId): Promise<{ verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'; verificationDocumentKey: DocumentKey | null } | null>`
  - `ReviewVerificationUsecase.execute(input: ReviewVerificationInput): Promise<void>`, `ReviewVerificationInput = { raceEntryId: RaceEntryId; decision: 'APPROVE' | 'REJECT'; reviewerId: StaffId; reviewedDocumentKey: DocumentKey; reason: string | null }`.
  - `ReviewVerificationModule` (providers: usecase + db; exports the usecase).
  - `RaceEntryService.reviewVerification(input: ReviewVerificationInput): Promise<void>`, a thin delegate. No controller calls it in this ticket; HYR-29 will.

Rules: `markReviewed` updates `WHERE id AND verification_status = 'PENDING' AND verification_document_key = expectedDocumentKey` setting status, `verifiedAt = at`, `verifiedBy = reviewerId`, `verificationRejectionReason` (reason on reject, null on approve). Count 0 -> `findState`: null -> `NotFoundError('race_entry_not_found')`; status not `PENDING` -> `ConflictError('verification_not_pending')`; otherwise `ConflictError('verification_document_changed')`; each with a warn log. A reject with a blank (trimmed) `reason` throws `InvalidValueError('rejection_reason_required')` before touching the db.

- [ ] **Step 1: Write failing spec**

Nested `describe` per condition: approving a PENDING entry with the matching key (db called with `decision: 'VERIFIED'`, `rejectionReason: null`, `reviewerId`, `at` = fake now); rejecting with a reason (`decision: 'REJECTED'`, trimmed reason passed through); rejecting with an empty or whitespace reason (`InvalidValueError('rejection_reason_required')`, db not called); CAS misses with `findState` returning null / status VERIFIED / status PENDING with a different key (the three codes above, asserting class, code and warn log).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/races/usecases/review-verification`. Expected: FAIL.

- [ ] **Step 3: Implement db, usecase, module and delegate**

Db: `updateMany` for `markReviewed` (returns `result.count`) and `findUnique` with `select` for `findState` (brand the key with `documentKey()` when non-null). Usecase maps `'APPROVE' -> 'VERIFIED'` and `'REJECT' -> 'REJECTED'` through a local `as const` object and trims the reason. Add the delegate to `RaceEntryService`, update the service spec providers and add a delegation test, import `ReviewVerificationModule` in `RacesModule`.

- [ ] **Step 4: Run to verify pass, check, stage**

Run: `npx vitest run src/races && npm run lint && npm run lint:arch && npm run build`. Stage: `git add src/races`.

---

### Task 7: Athlete controller, DTOs and module wiring

**Files:**
- Create: `src/races/dto/race-entry-params.dto.ts`, `src/races/dto/race-entry-params.dto.spec.ts`, `src/races/dto/submit-verification.dto.ts`, `src/races/dto/submit-verification.dto.spec.ts`, `src/races/race-entry-verification.controller.ts`, `src/races/race-entry-verification.controller.spec.ts`
- Modify: `src/races/races.module.ts` (import `AuthModule`, register the controller)

**Interfaces:**
- Consumes: `RaceEntryService.submitVerificationDocument` and `getVerificationStatus` (Tasks 4, 5), `JwtAuthGuard` (`src/auth/jwt-auth.guard.ts`), `CurrentAthleteId` (`src/auth/current-athlete-id.decorator.ts`), `raceEntryId()` (Task 2), `InvalidValueError`.
- Produces (spec 3.4):
  - `RaceEntryParamsDto { raceEntryId: RaceEntryId }`, same shape as `AthleteParamsDto`: `@Transform(({ value }) => (typeof value === 'string' ? raceEntryId(value) : value)) @IsString() raceEntryId!: RaceEntryId;`
  - `SubmitVerificationDto { bibNumber: string }`: `@Transform` trims strings, `@IsString() @Length(1, 20)`.
  - `RaceEntryVerificationController` at `@Controller('race-entries/:raceEntryId')`, class-level `@UseGuards(JwtAuthGuard)`:
    - `POST verification-document`, `@UseInterceptors(FileInterceptor('document', { limits: { fileSize: 10_485_760 } }))` (memory storage is multer's default), 201, returns `{ raceEntryId, verificationStatus: 'PENDING', submittedAt }`. No file -> `InvalidValueError('document_missing')`.
    - `GET verification` -> `VerificationStatusView`.
    - Both read the athlete from `@CurrentAthleteId()` (`AthleteId | undefined`); a private `requireAthleteId(athleteId: AthleteId | undefined): AthleteId` throws `UnauthorizedException('invalid_token')` on `undefined` (type narrowing only; the guard guarantees it is set).
  - `RacesModule` imports `AuthModule` (provides `TokenService` so `JwtAuthGuard` resolves) and registers the new controller next to `RaceEntryController`.

- [ ] **Step 1: Write failing specs**

Controller spec instantiates `new RaceEntryVerificationController(service)` with `mockDeep<RaceEntryService>()`, like `race-entry.controller.spec.ts`, and passes a fake file `{ buffer: Buffer.from('%PDF-1.7') } as Express.Multer.File`. Nested `describe`s: upload with no file -> `InvalidValueError('document_missing')`; upload when the athlete id is `undefined` -> `UnauthorizedException('invalid_token')`; upload happy path -> service called with `{ athleteId, raceEntryId, bibNumber, file: buffer }` and the response shape above; status read delegates with the athlete id and `raceEntryId`. DTO specs through `createValidationPipe()` (see `log-race.dto.spec.ts`): `bibNumber` trimmed, blank, 21 characters and non-string fail with `validation_failed`; `RaceEntryParamsDto` converts a valid id and rejects a blank one.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `npx vitest run src/races`. Implement DTOs, controller and module wiring. Expected: PASS.

- [ ] **Step 3: Boot smoke test**

With a free Postgres and MinIO running (`docker compose up -d`; use throwaway containers on other ports if 5435 is held by another workspace), load `.env` (needs HYR-3's `JWT_SECRET` and the storage vars), then `npm run build && node dist/main.js`. Expect a clean start with no DI errors, `curl -i localhost:3000/race-entries/x/verification` returns 401 `invalid_token`, and a signed-up athlete's token can upload a small PDF for an entry created via `POST /athletes/:athleteId/race-entries` (future-dated race) and read its status. Stop the server.

- [ ] **Step 4: Check and stage**

Run: `npm run lint && npm run lint:arch && npm test && npm run build`. Stage: `git add src/races package.json package-lock.json`.

---

### Task 8: Docs, final verification and handoff

**Files:**
- Modify: `README.md`, `docs/specs/2026-09-28-core-data-model-design.md`, `docs/plans/2026-09-28-core-data-model-plan.md`

- [ ] **Step 1: Document**

README: add a "Verification documents" section: the storage env vars, creating the MinIO bucket `hyrox-verification-docs` via the console (port 9006), the two athlete endpoints and that they need a HYR-3 bearer token, the shadow-database migration check, and the HYR-8 gate contract (`RaceEntryService.assertVerified`/`isVerifiedById`; HYR-8's due-auctions query MUST filter `verificationStatus: 'VERIFIED'` because there is no DB trigger). Note that the staff review API and staff auth are HYR-29 and that `RaceEntryService.listAwaitingReview`, `getDocumentAccess` and `reviewVerification` exist for it. In the two HYR-2 docs add one line next to the `verificationDocumentUrl` mention: "Renamed to `verificationDocumentKey` in HYR-6, see `docs/specs/2026-10-01-bib-verification-gate-design.md`."

- [ ] **Step 2: Full verification**

Run: `npm run build && npm run lint && npm run lint:arch && npm test`, plus the Task 1 shadow-database diff (expect an empty migration). Expected: all pass.

- [ ] **Step 3: Stage and stop**

Stage everything for this ticket (`git add -A`, leaving unrelated files alone). Do NOT commit. Move Linear HYR-6 to In Review, tell the user the work is staged and that they can run `/crit` to review the diff first, and wait for their go-ahead. When approved, commit with a Conventional Commit (for example `feat(races): add bib verification upload and review gate`) ending with the attribution trailer from the session instructions. Rename the branch to `hyr-06` before pushing or opening a PR.
