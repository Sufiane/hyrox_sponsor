# HYR-6: Bib/Confirmation Upload and Verification Gate — Design Spec

Status: DRAFT, final scope after user decisions of 2026-10-02 and 2026-10-03; pending sign-off on the open questions in section 9
Ticket: Linear HYR-6 (project "Hyrox Sponsor — MVP", milestone M1 — Listing & Body Map). Description is empty; everything below beyond the title is inferred.
Blocked by: HYR-2, HYR-3 (athlete auth), HYR-5 (race logging), all merged. Blocks: HYR-8 (auction scheduling job). Split out to HYR-29: staff auth and the staff review API.
Date: 2026-10-01 (revised 2026-10-03 against the code on `main`)

## 1. Context and goal

State of the repo this spec is written against (HEAD `9e1dbb8`):

- HYR-2 data model: `RaceEntry.verificationStatus` (`PENDING/VERIFIED/REJECTED`, default `PENDING`), `verificationDocumentUrl`, `verifiedAt`, `verifiedBy`.
- HYR-3: `JwtAuthGuard` (`src/auth/jwt-auth.guard.ts`) sets `request.athleteId`; `@CurrentAthleteId()` (`src/auth/current-athlete-id.decorator.ts`) returns `AthleteId | undefined`; `AuthModule` exports `JwtAuthGuard` and `TokenService`; global `ValidationPipe` (`createValidationPipe()`, errors surface as `validation_failed`), CORS, throttler, `@nestjs/config` with validated `EnvironmentVariables` (`src/config/env.validation.ts`), global `DomainErrorFilter` mapping `InvalidValueError`/`ForbiddenError`/`NotFoundError`/`ConflictError` to 400/403/404/409. HYR-3 has no roles and no staff auth.
- HYR-5: `POST /athletes/:athleteId/race-entries` (`RaceEntryController`, athlete id from the path, not JWT-guarded, a known accepted IDOR owned by that ticket) creates a `RaceEntry` in `PENDING` with `division`, `raceDate`, `raceLocalDate` and `bibNumber = null`. HYR-5 made `bibNumber` nullable explicitly because bib entry belongs to HYR-6. `RaceEntryService` has `logRace` (delegate to `LogRaceUsecase`, each usecase has its own Nest module, e.g. `LogRaceModule`) and `isVerified(athleteId, raceId)`.
- Conventions now in force: relative imports without `.js` (build uses `tsc-alias`), domain errors instead of Nest HTTP exceptions, `*.usecase.ts` + `*.usecase.db.ts` + a per-usecase Nest module, numeric separators on literals of 5+ digits, `ConfigService<EnvironmentVariables, true>` for env.

HYR-6 delivers:

1. An athlete uploads a bib/confirmation document for one of their race entries and supplies the bib number (HYR-5 left it null).
2. The backend capabilities staff review needs: awaiting-review queue, signed document URL, approve/reject usecase that takes a `reviewerId`.
3. A service-level gate that HYR-8 (and the future auction-creation flow) calls so an auction cannot be created or opened for an unverified entry.

Not delivered here (see section 8, Deferred to HYR-29): staff authentication/roles and every staff-facing HTTP endpoint.

Out of scope: auction creation and the scheduling job (HYR-8), proof-of-sponsorship upload, any frontend (none exists in the repo), notification emails, retention/purge job, OCR or results-API checking.

## 2. Design summary

- **Storage:** private S3-compatible bucket behind a `DocumentStorage` port (abstract class DI token). One adapter file wraps `@aws-sdk/client-s3` and is the only file allowed to import it (new dependency-cruiser rule). Stores the object key, never a URL. Staff will view documents through short-lived signed GET URLs (service method built here, consumed by HYR-29).
- **Upload path:** multipart through the API (multer memory storage, 10 MB cap), server-side magic-byte type sniffing (JPEG, PNG, WebP, PDF), body carries `bibNumber`.
- **Review:** manual staff review. The review usecase and `RaceEntryService.reviewVerification` exist and are unit-tested here; they take `reviewerId: StaffId`. HYR-29 adds auth and controllers.
- **Status model:** keep the existing three-value enum. "Awaiting review" is `PENDING` with a non-null document key. No enum migration.
- **Gate:** `RaceEntryService.assertVerified(raceEntryId)` and `isVerifiedById(raceEntryId)`. Service-level only; no DB trigger (decided).
- **HTTP in this ticket:** two athlete endpoints behind `JwtAuthGuard`. No staff endpoints.

## 3. Assumptions and open design questions

Each item states the assumption, the recommended resolution, and the cost of being wrong. DECIDED marks user decisions.

### 3.1 Where do uploads live? (storage) — recommend S3-compatible object storage

Options: local disk (rejected: ephemeral, no signed access), Postgres bytea (rejected: bloats DB and backups), S3-compatible bucket (AWS S3, Cloudflare R2, Railway bucket, MinIO locally; recommended).

- Hosting provider is undecided in the repo. The port plus an S3-compatible adapter makes it a config change. Env (validated in `EnvironmentVariables`): `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` required, `STORAGE_ENDPOINT` optional (set for MinIO/R2). Question: which provider for staging/prod?
- Pass-through multipart vs presigned direct upload. Recommend pass-through for the MVP: documents are small, volume is one per race entry, and the server can sniff and size-check bytes. Cost: the API buffers up to 10 MB per request in memory. Revisit if volume grows.
- Private bucket, no public ACL. Documents may contain PII. Object keys are `race-entries/<raceEntryId>/<uuid>.<ext>`; the original filename is never used or stored.
- Rename column `verification_document_url` to `verification_document_key` (Prisma `verificationDocumentKey`): we store a key and "url" would invite storing a public link. Table has data only if HYR-5 entries exist, and the rename preserves it.
- Retention/purge out of scope. Recommend keeping documents until at least race date + 90 days and adding a purge job later. Question: any legal retention requirement?
- Local dev: MinIO in `docker-compose.yml`. Host ports must not collide with other projects (5432-5434 are other projects, 5435 may be held by another workspace's container); use 9005 (API) and 9006 (console) after checking they are free.

### 3.2 Who verifies? — manual staff review (DECIDED scope: backend capability here, staff API in HYR-29)

No official results API in the MVP and proof review is already manual, so automatic verification (OCR of unknown confirmation formats) is out of proportion. This ticket builds the review usecase (`ReviewVerificationUsecase`), `RaceEntryService.reviewVerification`, the awaiting-review list and the signed-URL method so HYR-29 only adds auth and controllers. `verifiedBy` stays a plain nullable string column fed by `reviewerId`.

`StaffId`: this ticket adds the brand `StaffId = Brand<string, 'StaffId'>` and a validating constructor `staffId(value: string): StaffId` (trim, 1 to 64 characters, `InvalidValueError('staff_id_invalid')`) in `src/common/ids.ts`, mirroring `athleteId`. HYR-29 decides where staff identities come from and calls `staffId()` at its boundary. Nothing in this ticket supplies a `StaffId` at runtime; only tests do.

### 3.3 Status model and transitions — recommend no enum change

`PENDING` currently means both "no document yet" and "waiting for review". Options: add `UNSUBMITTED` (cleaner, but changes a merged enum and its default), or keep the enum and treat `PENDING AND verification_document_key IS NOT NULL` as awaiting review (recommended).

Transitions, all enforced by compare-and-set updates:

| From | Action | To | Actor |
|---|---|---|---|
| PENDING (no document) | upload with bib number | PENDING (document, bib, `verificationSubmittedAt` set) | athlete (owner) |
| PENDING (has document) | upload (replace) | PENDING (new document, bib updated) | athlete (owner) |
| REJECTED | upload (resubmit) | PENDING (reviewer fields and rejection reason cleared) | athlete (owner) |
| PENDING (has document) | approve | VERIFIED (`verifiedAt`, `verifiedBy` set) | reviewer (via HYR-29) |
| PENDING (has document) | reject (reason required) | REJECTED (`verifiedAt`, `verifiedBy`, reason set) | reviewer (via HYR-29) |
| VERIFIED | any upload | `race_entry_already_verified` (409) | n/a |
| VERIFIED | revoke | not supported in MVP | n/a |

- `verifiedAt`/`verifiedBy` double as reviewedAt/reviewedBy and are also set on rejection. Documented here so nobody reads `verifiedAt` as "was verified".
- Replace-while-reviewing race: approve/reject take the `reviewedDocumentKey` the reviewer saw; the update is `WHERE id = ? AND verification_status = 'PENDING' AND verification_document_key = ?`. Mismatch gives 409 `verification_document_changed`.
- Revocation of a VERIFIED entry is deferred (interacts with open auctions and escrow holds).
- New columns: `verification_submitted_at timestamptz(3)` (queue ordering, oldest first), `verification_rejection_reason text` (max 500 chars, shown to the athlete). New index `(verification_status, verification_submitted_at)`. `bib_number` already exists and is nullable (HYR-5); this ticket writes it.
- Upload eligibility: entry exists and belongs to the caller (else 404 `race_entry_not_found`, no ownership leak), athlete not banned (`athlete_banned`, 403, same code as HYR-5), entry not VERIFIED, race not started (`race_already_started`, 409, `raceDate <= now`). HYR-5 allows logging past races (self-reported history); those can never be auctioned, so uploads for them are rejected. Question: should past-race entries be verifiable for history? Recommend no. `isAdult` attestation is not checked here.
- Bib number: free text, trimmed, 1 to 20 characters; not branded (free text per convention). Uniqueness of a bib per race is not enforced (no real-world bib format known); reviewers compare it with the document.

### 3.4 API shape — athlete endpoints only (DECIDED: real HYR-3 auth)

Controller `RaceEntryVerificationController` at `race-entries/:raceEntryId`, `@UseGuards(JwtAuthGuard)`, athlete id from `@CurrentAthleteId()` (returns `AthleteId | undefined`; the controller narrows `undefined` to `UnauthorizedException('invalid_token')`, matching the guard's code; it cannot occur behind the guard). Path param DTO `RaceEntryParamsDto` converts through a new `raceEntryId(value)` constructor in `ids.ts` (mirrors `AthleteParamsDto`/`athleteId`).

- `POST /race-entries/:raceEntryId/verification-document`
  - multipart: file field `document` (max 10 MB; JPEG/PNG/WebP/PDF by magic bytes, `Content-Type` and extension ignored) and text field `bibNumber`.
  - 201 with `{ raceEntryId, verificationStatus: 'PENDING', submittedAt }`.
  - Errors (domain errors, existing taxonomy): 400 `document_missing`, 400 `document_too_large`, 400 `document_type_unsupported`, 400 `validation_failed` (bad `bibNumber`), 404 `race_entry_not_found`, 403 `athlete_banned`, 409 `race_entry_already_verified`, 409 `verification_state_changed`, 409 `race_already_started`. Files over the multer limit are rejected by multer first with Nest's default 413 `File too large`. 413/415 domain errors are not added; the existing four domain error classes cover the rest.
- `GET /race-entries/:raceEntryId/verification`
  - 200 with `{ raceEntryId, verificationStatus, bibNumber, hasDocument, rejectionReason, submittedAt, reviewedAt }`. Athletes poll (no emails in MVP). Never returns the document key or a URL.

Throttling uses HYR-3's global default; no tightening here.

### 3.5 The gate HYR-8 checks — service-level only (DECIDED: DB trigger dropped)

In `RaceEntryService` (exported from `RacesModule`):

- `assertVerified(raceEntryId: RaceEntryId): Promise<void>` throws `NotFoundError('race_entry_not_found')`, or `ConflictError('race_entry_not_verified')` when the status is not `VERIFIED`.
- `isVerifiedById(raceEntryId: RaceEntryId): Promise<boolean>`.
- Existing `isVerified(athleteId, raceId)` is unchanged.

This is the only enforcement of the invariant (no trigger, no hand-written SQL). Hard requirements on HYR-8 and the future auction-creation flow:
- The "due to open" query in HYR-8's db file MUST filter `raceEntry: { verificationStatus: 'VERIFIED' }` so unverified entries are never loaded, and the open step should also call `assertVerified` as defense in depth.
- Auction creation must call `assertVerified` too (HYR-2 spec 5.4).
- Late verification: if an entry is verified after `openAt` (race day minus 12 days), when and whether HYR-8 opens that auction is HYR-8's decision (open at the next tick but still close at `closeAt`, or cancel). Flagged so the shortened window is a conscious choice.

This ticket tests the gate service methods for every status (missing, PENDING, REJECTED, VERIFIED).

### 3.6 Other assumptions

- A `RaceEntry` already exists when the athlete uploads: HYR-5 creates it. HYR-6 creates none and the upload is the step that supplies the bib number. DECIDED by repo state; the earlier "no bib in upload" assumption is withdrawn.
- One document per entry at a time.
- No malware scanning in the MVP. Mitigations: magic-byte allowlist, private bucket, served only via signed URLs with `Content-Disposition: attachment`. Question: antivirus required? Recommend no.
- No review-history table; `verifiedBy`/`verifiedAt` hold the latest decision only. A rejected-then-resubmitted entry loses the earlier rejection (log lines carry the history).
- The HYR-5 route `POST /athletes/:athleteId/race-entries` still trusts the path athlete id. HYR-6 does not touch it; the new endpoints use JWT ownership. Flagged because the two entry points are inconsistent until that route is guarded.

## 4. Architecture

### 4.1 Files

New (relative imports without extensions):

```
src/common/ids.ts                        add raceEntryId(), StaffId + staffId()   (RaceEntryId type already exists)
src/common/ids.spec.ts                   extend
src/common/document-key.ts (+ .spec)     DocumentKey brand, documentKey(), buildDocumentKey(), DOCUMENT_KEY_PATTERN
src/common/document-sniffer.ts (+ .spec) detectDocumentType(buffer) (pure)
src/storage/document-storage.ts          abstract class DocumentStorage (put/delete/signedGetUrl)
src/storage/s3-document-storage.ts       adapter; ONLY file importing @aws-sdk/*; reads ConfigService<EnvironmentVariables, true>
src/storage/storage.module.ts            provides/exports DocumentStorage
src/races/usecases/submit-verification-document/
  submit-verification-document.usecase.ts, .usecase.db.ts, .module.ts, specs
src/races/usecases/review-verification/
  review-verification.usecase.ts, .usecase.db.ts, .module.ts, specs
src/races/race-entry-verification.controller.ts (+ spec)
src/races/dto/race-entry-params.dto.ts (+ spec)
src/races/dto/submit-verification.dto.ts (+ spec)
```

Modified: `prisma/schema.prisma`, new migration, `src/config/env.validation.ts` (+ spec), `src/races/race-entry.db.ts`, `race-entry.service.ts` (+ spec), `races.module.ts` (imports `AuthModule`, `StorageModule` via usecase module, the two usecase modules; registers the controller), `.dependency-cruiser.cjs`, `docker-compose.yml`, `.env.example`, `package.json`, `README.md`. `main.ts` and `app.module.ts` are not touched.

Call direction per CLAUDE.md: controller -> `RaceEntryService` -> usecase -> usecase's own db. The usecase dbs are new narrow classes (no entanglement with `RaceEntryDb`, so no shared-class interim shortcut). Simple reads and the gate stay as service -> `RaceEntryDb` passthroughs.

### 4.2 Submit usecase (steps)

Input `{ athleteId, raceEntryId, bibNumber, file: Buffer }`.
1. Load entry with athlete standing (own db). Missing or `athleteId` mismatch: warn log, `NotFoundError('race_entry_not_found')`.
2. Banned: `ForbiddenError('athlete_banned')`. VERIFIED: `ConflictError('race_entry_already_verified')`. `raceDate <= now`: `ConflictError('race_already_started')`.
3. Validate buffer: empty `InvalidValueError('document_missing')`, over 10 MB `InvalidValueError('document_too_large')`, unknown type `InvalidValueError('document_type_unsupported')`.
4. Build key, `storage.put`.
5. Compare-and-set update (own db), matching status in (PENDING, REJECTED) AND the previously read document key; sets key, `bibNumber`, `verificationSubmittedAt`, status PENDING and clears reviewer fields and rejection reason. Zero rows: delete the new object, `ConflictError('verification_state_changed')`.
6. On success delete the previous object best effort (log, never throw).
7. On unexpected db failure delete the new object best effort and rethrow.

### 4.3 Review usecase (steps)

`execute({ raceEntryId, decision: 'APPROVE' | 'REJECT', reviewerId: StaffId, reviewedDocumentKey: DocumentKey, reason: string | null })`. Blank reason on reject: `InvalidValueError('rejection_reason_required')`. Compare-and-set update as in 3.3. On zero rows a follow-up read distinguishes `NotFoundError('race_entry_not_found')`, `ConflictError('verification_not_pending')`, `ConflictError('verification_document_changed')`.

### 4.4 Branded types

`RaceEntryId` (exists), `StaffId` (new), `DocumentKey` (new, validated shape). Casts only in `*.db.ts`, the S3 adapter and `src/common` constructors. Free-text fields (`bibNumber`, rejection reason) are not branded.

### 4.5 Dependency-cruiser and config

New rule `no-aws-sdk-outside-storage-adapter`: only `src/storage/s3-document-storage.ts` may import `@aws-sdk/*`. Storage env vars are added to `EnvironmentVariables` and validated at boot (required except `STORAGE_ENDPOINT`), instead of a separate loader. Dependencies (exact-pinned): `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, dev `@types/multer`. `class-validator`/`class-transformer` already installed by HYR-3.

## 5. Data model changes

New migration `prisma/migrations/20261003110000_race_entry_verification/migration.sql` (must sort after the latest existing `20261003100000_add_race_entry_division_and_race_name_key`):

1. `ALTER TABLE race_entries RENAME COLUMN verification_document_url TO verification_document_key;` (hand-edit; Prisma would generate drop and add).
2. `ADD COLUMN verification_submitted_at TIMESTAMPTZ(3), ADD COLUMN verification_rejection_reason TEXT;`
3. `CREATE INDEX` on `(verification_status, verification_submitted_at)`.

No trigger and no other hand-written SQL. Run the README shadow-database `migrate diff` check afterwards; expected output is an empty migration, with no `DROP` of the existing hand-written CHECK and partial index. Schema: `verificationDocumentKey String? @map("verification_document_key")`, `verificationSubmittedAt DateTime? @map("verification_submitted_at") @db.Timestamptz(3)`, `verificationRejectionReason String? @map("verification_rejection_reason")`, `@@index([verificationStatus, verificationSubmittedAt])`. The HYR-2 spec/plan mention `verificationDocumentUrl`; add a one-line pointer to this spec rather than rewriting history.

## 6. Error handling and logging

Domain errors with snake_case codes (section 3.4, 4.2, 4.3 plus `race_entry_not_verified`); readable detail with ids goes to the class `Logger` (`warn`) at each throw site. Never log signed URLs or file contents.

## 7. Testing

Vitest, `mockDeep`, nested `describe` per condition, warn logs asserted with `vi.spyOn(Logger.prototype, 'warn')`.

- `ids.spec`: `raceEntryId`, `staffId` blank, trimmed, over 64 characters.
- `document-key`, `document-sniffer`: plain specs.
- `env.validation.spec`: storage vars required, `STORAGE_ENDPOINT` optional.
- `RaceEntryService` gate (required by the user decision): `assertVerified` per status (missing, PENDING, REJECTED, VERIFIED) and `isVerifiedById` per status. Also status view (never exposes the key), queue maps only entries with documents, signed URL needs a document, delegation to both usecases.
- Submit usecase: not found, wrong owner, banned, already verified, race started, empty, too large, wrong type, happy paths (PENDING and REJECTED sources, bib stored), CAS lost (new object deleted), db failure (new object deleted, error rethrown), old-object cleanup failure not thrown.
- Review usecase: approve, reject, blank reason, not pending, document changed, not found; db receives `reviewerId`.
- Controller spec (direct instantiation like `RaceEntryController`'s spec): missing file, undefined athlete id, happy path delegation, status read. DTO specs through `createValidationPipe()`.
- Gates: `npm run build && npm run lint && npm run lint:arch && npm test`, plus the shadow-database migration check. QA stage can run the real flow against MinIO.

## 8. Deferred to HYR-29 (decided scope)

HYR-29: "Staff auth + bib verification review API: queue, approve, reject". It owns:

- Staff authentication and roles (guard, token or session model, where staff identities live, calling `staffId()` at its boundary).
- Staff controllers and DTOs: queue, signed document URL, approve, reject (route prefix suggestion `/admin/race-entries/...`).
- Request DTO validation for review bodies (`reviewedDocumentKey` should match `DOCUMENT_KEY_PATTERN`, `reason` 1 to 500 characters).

HYR-29 consumes these built here: `RaceEntryService.listAwaitingReview(): Promise<AwaitingReviewItem[]>`, `getDocumentAccess(raceEntryId): Promise<{ url, expiresAt, documentKey }>` (300 second TTL), `reviewVerification({ raceEntryId, decision, reviewerId: StaffId, reviewedDocumentKey: DocumentKey, reason })`, and the error codes in 4.3. The signed-URL response must be served with `Cache-Control: no-store` by HYR-29's controller.

## 9. Open questions summary (confirm or override)

1. Storage provider for staging/prod (recommend S3-compatible; R2 or S3 both fit).
2. Pass-through multipart vs presigned direct upload (recommend pass-through).
3. Status enum unchanged, "awaiting review" = PENDING with a document (recommend yes).
4. Defer revocation of VERIFIED entries (recommend yes).
5. Rename `verification_document_url` to `verification_document_key` (recommend yes).
6. Reject uploads for races already started, so past self-reported races cannot be verified (recommend yes).
7. Athlete learns of the decision by polling, no email (recommend yes).
8. Retention: keep until race date + 90 days, purge job later (legal requirement unknown).
9. No antivirus scanning in the MVP (recommend yes).
10. Bib number: free text 1 to 20 characters, no per-race uniqueness (recommend yes).
11. HYR-8 policy for entries verified after `openAt` (open late vs cancel) is HYR-8's decision.
12. DECIDED: no DB trigger, service-level gate only; HYR-8 must filter `verificationStatus: 'VERIFIED'`.
13. DECIDED: staff auth and staff endpoints are HYR-29; this ticket builds the usecase, service methods and `StaffId` brand only.
14. DECIDED: athlete endpoints use HYR-3's `JwtAuthGuard` and `@CurrentAthleteId()`.
