# Bib Review API (HYR-33) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Staff (via `StaffGuard`) can list the bib review queue, get a short-lived signed document URL, and approve/reject with the document key they saw; the staff id is stored in `verifiedBy`.

**Architecture:** One thin controller + two DTOs in `src/races/`, delegating to existing `RaceEntryService` methods (`listAwaitingReview`, `getDocumentAccess`, `reviewVerification`). `RacesModule` imports `StaffAuthModule`. No schema/service/usecase/db change.

**Tech Stack:** NestJS 12, class-validator/transformer, Vitest 5 + `vitest-mock-extended`. No new dependencies.

**Spec:** `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/stockholm-v1/docs/specs/2026-10-10-bib-review-api-design.md`

## Global Constraints

- Working dir `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/stockholm-v1`, branch `hyr-33` (do not rename after a PR exists). Backend-only; no `web/` or `shared/` change.
- Explicit return types; no single-letter names; no inline `if`; blank line before `if`/`for`/`while`/`return`/`throw` unless first in block; `readonly` constructor params; numeric separators on 5+ digit literals; no barrel files; no comments unless non-obvious why; snake_case error codes.
- Relative imports without `.js`. No ORM imports in new files (`npm run lint:arch`).
- Tests: nested `describe` per condition (`when ...`), `it` titles state only outcome, shared setup in `beforeEach`.
- Git: conventional commits (`feat(races): ...`). Do NOT commit; stage and stop for the user's `/crit`. Commit footer when later made: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Reference patterns: `src/races/race-entry-verification.controller.ts` (+ spec), `src/races/dto/race-entry-params.dto.ts` (+ spec), `src/staff-auth/staff-auth.controller.ts`.

## File Structure

Create:
- `src/races/dto/approve-verification.dto.ts`, `approve-verification.dto.spec.ts`
- `src/races/dto/reject-verification.dto.ts`, `reject-verification.dto.spec.ts`
- `src/races/staff-race-entry-review.controller.ts`, `staff-race-entry-review.controller.spec.ts`

Modify:
- `src/races/races.module.ts` (import `StaffAuthModule`, register controller)
- `README.md` (document the four endpoints)

## Task 1: Review DTOs

**Files:** the four DTO files above.

- [ ] **Step 1: Write failing specs** (use `createValidationPipe().transform(payload, { type: 'body', metatype })` as in `race-entry-params.dto.spec.ts`, with `Logger.prototype.warn` spied). Cases:
  - Approve: valid key (`race-entries/entry1/<uuid>.pdf`) -> exposes branded key; malformed key -> `InvalidValueError` `document_key_invalid`; missing key -> rejects (`validation_failed`).
  - Reject: valid key + reason -> reason trimmed; blank/whitespace reason -> `validation_failed`; reason of 501 chars -> `validation_failed`; reason of 500 chars -> accepted; malformed key -> `document_key_invalid`.
- [ ] **Step 2: Run** `npx vitest run src/races/dto` and see failures.
- [ ] **Step 3: Implement.**
  - `ApproveVerificationDto { reviewedDocumentKey!: DocumentKey }` with `@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? documentKey(value) : value))` + `@IsString()`.
  - `RejectVerificationDto extends ApproveVerificationDto` adds `reason!: string` with a trim `@Transform`, `@IsString()`, `@Length(1, REASON_MAX_LENGTH)` (`REASON_MAX_LENGTH = 500` local const).
- [ ] **Step 4: Run** the DTO specs; pass. Stage.

## Task 2: Controller

**Files:** `src/races/staff-race-entry-review.controller.ts`, `.spec.ts`.

Signature outline (builder writes bodies test-first):

```ts
@Controller('staff/race-entries')
@UseGuards(StaffGuard)
export class StaffRaceEntryReviewController {
  constructor(private readonly service: RaceEntryService) {}

  @Get('awaiting-review') listAwaitingReview(): Promise<AwaitingReviewItem[]>
  @Get(':raceEntryId/verification-document-url') @Header('Cache-Control', 'no-store')
    getDocumentUrl(@Param() params: RaceEntryParamsDto): Promise<DocumentAccess>
  @Post(':raceEntryId/verification/approve') @HttpCode(204)
    approve(@CurrentStaffId() staffId: StaffId, @Param() params: RaceEntryParamsDto, @Body() body: ApproveVerificationDto): Promise<void>
  @Post(':raceEntryId/verification/reject') @HttpCode(204)
    reject(@CurrentStaffId() staffId: StaffId, @Param() params: RaceEntryParamsDto, @Body() body: RejectVerificationDto): Promise<void>
}
```

- [ ] **Step 1: Write failing spec** (`mockDeep<RaceEntryService>()`, direct instantiation). Cases:
  - `listAwaitingReview`: returns the service result.
  - `getDocumentUrl`: delegates with `params.raceEntryId`, returns the access object; if service rejects with `verification_document_not_found`, error propagates.
  - `approve`: calls `reviewVerification` with `{ raceEntryId, decision: 'APPROVE', reviewerId: staffId, reviewedDocumentKey, reason: null }`; resolves undefined; service conflict (`verification_document_changed`) propagates.
  - `reject`: same with `decision: 'REJECT'` and `reason`; `reviewerId` is the guard staff id.
  - Guard wiring: `Reflect.getMetadata('__guards__', StaffRaceEntryReviewController)` contains `StaffGuard`.
  - Header/status metadata: `Reflect.getMetadata('__httpCode__', ...prototype.approve)` is 204 (same for reject).
- [ ] **Step 2: Run** `npx vitest run src/races/staff-race-entry-review.controller.spec.ts`; fail.
- [ ] **Step 3: Implement** the controller per outline.
- [ ] **Step 4: Run**; pass.

## Task 3: Module wiring and docs

- [ ] **Step 1:** In `src/races/races.module.ts` add `StaffAuthModule` to `imports` and `StaffRaceEntryReviewController` to `controllers`.
- [ ] **Step 2:** Add a README section for the four endpoints (path, auth `Bearer` staff access token, bodies, status codes, error codes `verification_document_changed`, `verification_not_pending`, `rejection_reason_required`, `race_entry_not_found`, `verification_document_not_found`).
- [ ] **Step 3: Boot check:** `npm run build` (Nest DI resolves `StaffGuard` deps in `RacesModule` through the exported `StaffTokenService`/`StaffService`; if a DI error shows at boot, confirm `StaffAuthModule` exports them - it does today).

## Task 4: Gates

- [ ] `npm run build && npm run lint && npm run lint:arch && npm test`; all green.
- [ ] Stage all changes; do not commit. Tell the user to run `/crit`. Move Linear HYR-33 to In Progress when starting, In Review only once staged.

## QA hints (for qa-verifier)

Create a staff account via `npm run staff`, log in at `POST /staff/auth/login`, upload a document as an athlete (HYR-6 endpoint), then: queue shows the entry; signed URL fetches the file; approve with the right key -> 204 and `verified_by` = staff id; approve with a stale key -> 409; reject without reason -> 400; no/athlete token -> 401.
