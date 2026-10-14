# HYR-33: Bib Review API (staff) - Design Spec

Status: DRAFT, decisions below made by the planner without interactive sign-off; confirm or override in section 6.
Ticket: Linear HYR-33. Depends on HYR-6 (review usecase, storage, gate) and HYR-29 (`StaffGuard`), both merged.
Date: 2026-10-10

## 1. Context and goal

HYR-6 deliberately left staff HTTP to this ticket. Already on the branch and reused unchanged:

- `RaceEntryService.listAwaitingReview(): Promise<AwaitingReviewItem[]>` (PENDING + document key + submittedAt, oldest first, limit 50).
- `RaceEntryService.getDocumentAccess(raceEntryId): Promise<{ url, expiresAt, documentKey }>` (300 s signed GET, `verification_document_not_found` / `race_entry_not_found`).
- `RaceEntryService.reviewVerification({ raceEntryId, decision, reviewerId: StaffId, reviewedDocumentKey: DocumentKey, reason })` -> compare-and-set; writes `verifiedBy = reviewerId`; domain errors `race_entry_not_found` (404), `verification_not_pending` (409), `verification_document_changed` (409), `rejection_reason_required` (400).
- `StaffGuard`, `@CurrentStaffId()`, `StaffAuthModule` (exports `StaffGuard`, `StaffTokenService`, `StaffService`).
- `RaceEntryParamsDto`, `documentKey()` / `DOCUMENT_KEY_PATTERN`, global `DomainErrorFilter`, `createValidationPipe()`.

Goal: add the HTTP layer only. No schema change, no new service/usecase/db code, no new dependency, no frontend.

Out of scope: staff auth, revoking a VERIFIED entry, a review UI, pagination of the queue, review history.

## 2. Design

One new controller, `StaffRaceEntryReviewController`, in `src/races/`, `@Controller('staff/race-entries')` + `@UseGuards(StaffGuard)` at class level (prefix mirrors `staff/auth`). Thin: params -> `RaceEntryService` -> response. `StaffAuthModule` is imported into `RacesModule` (no cycle: it only imports `AuthModule`).

| Method + path | Purpose | Success |
|---|---|---|
| `GET /staff/race-entries/awaiting-review` | Review queue | 200 `AwaitingReviewItem[]` |
| `GET /staff/race-entries/:raceEntryId/verification-document-url` | Signed URL | 200 `{ url, expiresAt, documentKey }`, `Cache-Control: no-store` |
| `POST /staff/race-entries/:raceEntryId/verification/approve` | Approve | 204 |
| `POST /staff/race-entries/:raceEntryId/verification/reject` | Reject | 204 |

Static `awaiting-review` and the `:raceEntryId` routes have different segment counts, so no route shadowing.

Bodies (new DTOs, `src/races/dto/`):
- `ApproveVerificationDto { reviewedDocumentKey: DocumentKey }`.
- `RejectVerificationDto { reviewedDocumentKey: DocumentKey; reason: string }`.
- `reviewedDocumentKey`: `@Transform` through `documentKey()` (same pattern as `RaceEntryParamsDto`), so a malformed key is 400 `document_key_invalid` via the existing pipe/filter; `@IsString()` guard like the params DTO.
- `reason`: trimmed, `@IsString() @Length(1, 500)`. Blank or over-long gives 400 `validation_failed`. The usecase's `rejection_reason_required` stays as defense in depth.

Controller maps: approve -> `reviewVerification({ raceEntryId, decision: 'APPROVE', reviewerId: staffId, reviewedDocumentKey, reason: null })`; reject -> same with `'REJECT'` and `reason`. `reviewerId` is always the `@CurrentStaffId()` value, never body input, so it lands in `verified_by`.

Errors: missing/invalid/expired token -> 401 `invalid_token` from `StaffGuard` (athlete tokens rejected, already covered by HYR-29 `token-isolation.spec`). Everything else is the existing domain taxonomy above. 409 `verification_document_changed` is the "key changed since reviewer saw it" case.

Architecture: controller -> `RaceEntryService` (existing) -> usecase -> usecase db. No ORM in the new files; no new usecase because the controller adds no business logic. Branded types: `StaffId`, `RaceEntryId`, `DocumentKey` already exist; no new cast sites.

## 3. Testing

Vitest, direct controller instantiation with `mockDeep<RaceEntryService>()` (as `RaceEntryVerificationController` spec), nested `describe` per condition. DTOs via `createValidationPipe()`. Plus a metadata check that `StaffGuard` is applied at class level (`Reflect.getMetadata('__guards__', Controller)`), so removing it fails a test. Gates: `npm run build && npm run lint && npm run lint:arch && npm test`.

## 4. Docs

README: add the four endpoints under the staff section. `.env.example` unchanged.

## 5. Risks

- Queue unpaginated, hard-capped at 50 oldest; a backlog over 50 is invisible until older ones are cleared. Acceptable for MVP volume; cursor pagination is a follow-up.
- `AwaitingReviewItem` includes `athleteName` (PII) - staff-only, `no-store` not required but harmless to add; not added to keep scope tight.
- Any active staff member can review any entry (no roles, per HYR-29 D5).

## 6. Decisions made without sign-off (override if wrong)

1. Route prefix `staff/race-entries` (HYR-6 suggested `/admin/race-entries`; `staff/` matches HYR-29's `staff/auth`).
2. Signed URL is a GET returning JSON (not a 302 redirect), `Cache-Control: no-store`.
3. Approve/reject are POST returning 204 with no body.
4. Reject reason 1-500 chars enforced at DTO (400 `validation_failed`).
5. Queue not paginated (existing service limit 50).
6. No dedicated usecase/db/spec for new logic; controller-only.
7. Grill-me skipped: low-risk, all domain logic pre-exists and is tested.
