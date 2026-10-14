# Public Race Results Page (HYR-21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Athletes self-report a finish time with a clock photo and optional link; staff approve or reject; the public sees PENDING and VERIFIED results per race and division, ranks only VERIFIED times, and never sees photo, link or ids.

**Architecture:** New `race_results` table (1:1 with `race_entries`, own status lifecycle). Two new Nest modules: `src/race-results/` (athlete + staff, two usecases: submit and review, each with its own `*.usecase.db.ts`) and `src/public-results/` (unauthenticated read-only service/db). Result photos reuse the HYR-6 `DocumentStorage` port and sniffer under a new `ResultProofKey` brand. Web: public SSR routes `/results` and `/results/[raceId]`, an authenticated submit form and an entries list.

**Tech Stack:** NestJS 12, Prisma 6.19.3, Vitest 5, SvelteKit 3, Svelte 5, Tailwind 4. No new dependencies (pinned versions unchanged).

**Spec:** `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/sacramento/docs/specs/2026-10-10-public-race-results-design.md`

**Decision gate:** Before Task B1 the coordinator confirms spec section 9 open items. The plan assumes the stated defaults: D6 empty host allowlist (links refused until filled), D8 bounds 1_800 to 21_600 s, D9 photo optional on edit, D11 table `race_results`, D12 `rejection_reason` column, D13 allow submit with `publicVisible: false`, D14 submit throttle 10/min, D15 add own-entries list, D16 queue includes results whose bib is unverified, D20 division required. If D8 or D11 change, it only edits constants/names; D15 "no" drops B5 and F6.

## Global Constraints

- Working directory `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/sacramento`; branch `hyr-21` (rename before any PR; never after).
- Fresh worktree: `npm ci`, `npx prisma generate`; web checks need `npx svelte-kit sync`.
- Hexagonal: only `*.db.ts` and `*.usecase.db.ts` import `@prisma/client`/`src/prisma/`; `npm run lint:arch` must pass. Dbs return `null`/counts/arrays, no domain throws. Services/usecases throw `NotFoundError` / `ConflictError` / `ForbiddenError` / `InvalidValueError` with snake_case codes and `logger.warn` the readable detail. Call direction controller -> service -> usecase -> usecase db.
- Brands: `Seconds`, `ResultProofKey`, `RaceResultId`, `ProofUrl`, `RaceId` constructor. Cast to brands only in `*.db.ts` or the validating constructors; no mapping layer over ORM rows just to brand. Same-typed params use brands.
- Explicit return types; no single-letter names (except `i/j/k` in indexed loops); no inline `if`; blank line before `if/for/while/return/throw` unless first in block; `readonly` constructor properties; numeric separators on 5+ digit literals (`21_600`, `10_485_760`); no barrel files; no dead code; no comments unless a non-obvious why; no `!!`.
- Never log names, photo keys, URLs or tokens.
- Web: never `{@html}`; athlete and race strings render as text only.
- Tests: Vitest, nested `describe` per condition (`when ...`), `it` titles state only the outcome, shared setup in `beforeEach`, `mockDeep<...>()` for dbs/Prisma as in existing specs.
- Git: conventional commits (`feat(race-results): ...`, `feat(public-results): ...`, `feat(web): ...`). Do NOT commit: stage and stop for the user's `/crit`. Footer when later committed: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Plan gives signatures and test-case lists, not bodies; builders write code test-first.
- Hand-written SQL uses mapped snake_case names. Migration is generated with `prisma migrate diff` against a shadow DB (`migrate dev --create-only` does not run non-interactively), then hand-extended with CHECKs. Port 5435 is often held by another workspace's Postgres: use a throwaway container on another port.
- HYR-33 and HYR-23 branches currently equal HEAD (not in this tree). Mirror the HYR-33 review shape from `RaceEntryVerificationController` + `StaffGuard` + `review-verification` usecase; do not depend on files that do not exist.

## API contracts (both phases build to these)

Athlete (Bearer athlete JWT):
```
PUT  /race-entries/:raceEntryId/result      multipart: photo (file), finishTimeSeconds, proofUrl?
  -> 200 { raceEntryId, status: 'PENDING', submittedAt, publicVisible }
GET  /race-entries/:raceEntryId/result
  -> 200 { status, finishTimeSeconds, proofUrl: string|null, hasPhoto, rejectionReason: string|null,
           submittedAt, reviewedAt: string|null, publicVisible, bibVerificationStatus }   404 race_result_not_found
GET  /race-entries
  -> 200 { items: { raceEntryId, raceName, raceDate, timezone, division, bibVerificationStatus,
                    resultStatus: 'PENDING'|'VERIFIED'|'REJECTED'|null }[] }   (cap 50)
```
Staff (Bearer staff JWT):
```
GET  staff/race-results                       -> { items: { raceResultId, athleteName, raceName, raceDate, division,
                                                 finishTimeSeconds, hasProofUrl, submittedAt }[] }  (cap 50, oldest first)
GET  staff/race-results/:raceResultId         -> { raceResultId, athleteName, raceName, raceDate, division,
                                                 finishTimeSeconds, proofUrl, photoUrl, photoUrlExpiresAt, submittedAt }  no-store
POST staff/race-results/:raceResultId/approve  { submittedAt }          -> 204
POST staff/race-results/:raceResultId/reject   { submittedAt, reason }  -> 204
```
Public (no auth, `Cache-Control: public, max-age=60`):
```
GET /public/races?limit&cursor
  -> { items: { id, name, location, date, timezone, resultCount, verifiedCount }[], nextCursor: string|null }
GET /public/races/:raceId
  -> { id, name, location, date, timezone, divisions: { division, resultCount, verifiedCount }[] }   404 race_not_found
GET /public/races/:raceId/results?division=&limit&offset      (division required)
  -> { items: { rank: number|null, displayName, finishTimeSeconds, verified: boolean }[], total, verifiedTotal }
```
Error codes surfaced: `race_entry_not_found`, `athlete_banned`, `race_not_finished`, `proof_photo_missing`, `proof_photo_too_large`, `proof_photo_type_unsupported`, `finish_time_out_of_range`, `proof_url_invalid`, `proof_url_host_not_allowed`, `race_result_not_found`, `result_not_pending`, `result_changed`, `rejection_reason_required`, `race_not_found`, `cursor_invalid`, `validation_failed`. Confirm the error body shape in `src/common/domain-error.filter.ts` before the web error mapping.

## File Structure

Backend create:
- `src/common/seconds.ts`, `seconds.spec.ts`; `src/common/result-proof-key.ts`, `result-proof-key.spec.ts`; `src/common/proof-url.ts`
- `src/race-results/proof-url-policy.ts`, `proof-url-policy.spec.ts`
- `src/race-results/race-result.db.ts`, `race-result.db.spec.ts`; `race-result.service.ts`, `race-result.service.spec.ts`
- `src/race-results/usecases/submit-race-result/` (`submit-race-result-input.ts`, `submit-race-result.usecase.ts`, `.usecase.db.ts`, `.module.ts`, specs)
- `src/race-results/usecases/review-race-result/` (`review-race-result.usecase.ts`, `.usecase.db.ts`, `.module.ts`, specs)
- `src/race-results/dto/` (`race-result-params.dto.ts`, `submit-race-result.dto.ts`, `review-race-result.dto.ts`, specs)
- `src/race-results/race-result.controller.ts`, `staff-race-result-review.controller.ts`, `race-results.module.ts`, controller specs
- `src/public-results/public-results.db.ts`, `.service.ts`, `.controller.ts`, `.module.ts`, `display-name.ts`, `race-cursor.ts`, `dto/*`, specs, `public-results.contract.spec.ts`
- `prisma/migrations/<timestamp>_add_race_results/migration.sql`

Backend modify: `prisma/schema.prisma`, `src/common/ids.ts` (+spec), `src/storage/document-storage.ts` and `s3-document-storage.ts` (key union), `src/config/env.validation.ts` (+spec), `.env.example`, `src/app.module.ts`, `README.md`.

Web create: `web/src/lib/results/` (`results-types.ts`, `format-finish-time.ts`, `format-race-date.ts`, `division-labels.ts`, `results-api.ts`, `result-submit-api.ts`, `finish-time-input.ts`, `RaceList.svelte`, `DivisionNav.svelte`, `Leaderboard.svelte`, `ResultSubmitForm.svelte`, `EntryList.svelte`, plus specs), routes `web/src/routes/results/+page.server.ts`+`+page.svelte`, `results/[raceId]/+page.server.ts`+`+page.svelte`, `results/submit/[raceEntryId]/+page.svelte`, `account/entries/+page.svelte`.
Web modify: `web/src/routes/+page.svelte` (links).

## Phase 1: Backend

### Task B1: foundations (blocks B2-B5)
- [ ] `schema.prisma`: enum `RaceResultStatus` (`@@map("race_result_status")`), model `RaceResult` per spec section 2 (`@@map("race_results")`, snake_case `@map`, `@@index([status, submittedAt])`, relation to `RaceEntry` with `onDelete: Cascade`, `RaceEntry.raceResult RaceResult?`). Generate migration SQL via `prisma migrate diff`; hand-add CHECKs: time bounds, `proof_url` https prefix, review-field consistency by status.
- [ ] `seconds.ts`: `Seconds` brand, `seconds(value: number): Seconds`, `MIN_FINISH_SECONDS = 1_800`, `MAX_FINISH_SECONDS = 21_600`. Spec: accepts bounds; rejects 0, negative, fractional, NaN, below min, above max (`finish_time_out_of_range`); non-integer `seconds_invalid`.
- [ ] `result-proof-key.ts`: `ResultProofKey`, `resultProofKey(value)`, `buildResultProofKey(raceEntryId, extension: 'jpg'|'png'|'webp')`. Spec: round trip; rejects a bib `race-entries/...` key, pdf extension, bad uuid, path traversal.
- [ ] `ids.ts`: add `raceId()` constructor and `RaceResultId` + `raceResultId()`; extend `ids.spec.ts`.
- [ ] `document-storage.ts` + S3 adapter: accept `DocumentKey | ResultProofKey` (type-only change); existing storage and bib specs stay green.
- [ ] `env.validation.ts`: `RESULT_PROOF_URL_HOSTS: string[]` parsed like `CORS_ORIGINS`, default `[]`; spec: empty, trimmed, lowercased, several hosts. `.env.example` entry with a comment that the real host must be filled before launch.
- [ ] `proof-url.ts` + `proof-url-policy.ts`: `parseProofUrl(raw: string, allowedHosts: readonly string[]): ProofUrl`. Spec cases: https allowed host ok; http rejected `proof_url_invalid`; userinfo trick `https://allowed.example@evil.test` rejected; port other than default rejected; host case-insensitive; subdomain not matched unless listed; empty allowlist -> `proof_url_host_not_allowed`; over 500 chars; garbage; `javascript:` and `data:` rejected.
- [ ] Run `npx prisma validate`, `npx prisma generate`, targeted specs, `npm run lint:arch`; apply migration to the throwaway DB; stage.

### Task B2: athlete submit and read (needs B1; independent of B3/B4/B5)
- [ ] `SubmitRaceResultUsecaseDb`: `findForSubmission(raceEntryId): { athleteId, athleteIsBanned, raceDate, bibVerificationStatus, existing: { id, status, proofPhotoKey: ResultProofKey, submittedAt } | null } | null`; `createResult(...)` and `updateResult(...)` where update is conditional on `submittedAt = existing.submittedAt` returning affected count and resets status/reviewer fields; unique-violation on create returns `null` (P2002 constant exists).
- [ ] `SubmitRaceResultUsecase.execute({ athleteId, raceEntryId, finishTimeSeconds: Seconds, proofUrl: string|null, photo: Buffer|null })`: eligibility order from spec section 3, sniff (reject pdf), `storage.put` new key, write row, on failure delete the new object, after success delete the replaced object quietly. Allowlist read from `ConfigService`. Result `{ status:'PENDING', submittedAt, publicVisible }` where `publicVisible` = bib VERIFIED.
  Spec `describe`s: when entry missing/other athlete's; when banned; when race not finished; when no existing and no photo; when photo oversize/empty/pdf/unknown type; when time out of range; when link host not allowed; when new result created; when PENDING result edited (stays PENDING, old photo deleted); when VERIFIED result edited (resets to PENDING, clears reviewer); when REJECTED resubmitted; when edit omits photo (old key kept, not deleted); when concurrent edit changes the row (409 `result_state_changed`, new object cleaned up); when storage put fails (nothing written); when old-photo delete fails (still succeeds).
- [ ] `RaceResultDb.findOwnResult(athleteId, raceEntryId)`; `RaceResultService.getOwnResult` throws `race_result_not_found`, computes `publicVisible`.
- [ ] DTOs: params (`raceEntryId` via `raceEntryId()` transform), submit body (`finishTimeSeconds` string->`seconds()`, `proofUrl` optional string max 500). `RaceResultController` (`@UseGuards(JwtAuthGuard)`, `FileInterceptor('photo', { limits: { fileSize: MAX_DOCUMENT_BYTES } })`, `@Throttle` 10/min on PUT). Controller spec: 401 without athlete id, missing file on create path is handled by the usecase, delegates args.
- [ ] Module `SubmitRaceResultModule` (imports `StorageModule`), wired via `RaceResultsModule`.
- [ ] Run specs and `lint:arch`; stage.

### Task B3: staff review (needs B1; independent of B2/B4/B5)
- [ ] `RaceResultDb`: `listPending(limit)` (PENDING, oldest `submittedAt`, include athlete name and race name/date via `select`), `findForStaff(id)` (adds proof url, photo key).
- [ ] `ReviewRaceResultUsecaseDb.markReviewed({ raceResultId, expectedSubmittedAt, decision, reviewerId, rejectionReason, at }): Promise<number>` conditional on `status = PENDING AND submitted_at = expected`; `findState(id)`.
- [ ] `ReviewRaceResultUsecase.execute`: reject needs trimmed non-empty reason (`rejection_reason_required`); on zero rows -> `race_result_not_found` / `result_not_pending` / `result_changed`. Spec per branch, mirroring the HYR-6 review spec.
- [ ] `RaceResultService.listAwaitingReview()` (cap 50 constant) and `getStaffDetail(id)` signing the photo with `DocumentStorage.signedGetUrl(key, 300)`, returning `expiresAt`; 404 `race_result_not_found`.
- [ ] `StaffRaceResultReviewController` (`@Controller('staff/race-results')`, `@UseGuards(StaffGuard)`, `@CurrentStaffId()`, approve/reject `@HttpCode(204)`, detail `Cache-Control: no-store`). DTO: `submittedAt` ISO date transformed to `Date`, `reason` trimmed 1-500. Controller spec: reviewer id only from decorator; 204s; no-store header.
- [ ] Module `ReviewRaceResultModule`; import `StaffAuthModule` (guard providers) in `RaceResultsModule`.
- [ ] Specs, `lint:arch`; stage.

### Task B4: public endpoints (needs B1; independent of B2/B3/B5)
- [ ] `display-name.ts` ("Jane Doe" -> "Jane D.", single token unchanged, multi-token first + last initial, whitespace collapsed, unicode initial, blank -> "Athlete") and `race-cursor.ts` (encode/decode `{date,id}`; garbage -> `InvalidValueError('cursor_invalid')`) with specs.
- [ ] `PublicResultsDb` with one shared `publicWhere` predicate (status IN PENDING/VERIFIED, entry bib VERIFIED, athlete not banned) used by every method, all `select`-whitelisted: `listRaces(limit+1, after)` with `resultCount`/`verifiedCount`; `findRaceDivisions(raceId)`; `countVerifiedFasterThan(raceId, division, seconds)`; `listVerified(raceId, division, offset, limit)`; `listUnverified(raceId, division, offset, limit)`; `countByStatus(raceId, division)`. Db spec asserts the predicate is present in every call, selects never include photo key, proof url, athlete id/email, bib, entry id; ordering args.
- [ ] `PublicResultsService`: map to views, apply `displayName`; ranking per spec 5.5 (competition ranking, first row of page via `countVerifiedFasterThan`); stitch verified then unverified across offset/limit; `total`, `verifiedTotal`; `race_not_found` for missing or no public result; cursor `nextCursor`. Spec `describe`s: ties (1,2,2,4); tie spanning a page boundary; page entirely in unverified region; page straddling verified/unverified; no verified results (unverified listed, ranks null); race with only REJECTED -> 404; limit clamp; first page / exact-limit cursor.
- [ ] DTOs (limit 1-50 races, 1-100 results, offset 0-10_000, `division` required enum, `cursor` max 200) and `PublicResultsController` (no guards, `Cache-Control: public, max-age=60`).
- [ ] `public-results.contract.spec.ts`: exact key sets of all three responses; no key containing `photo`, `proof`, `email`, `bib`; item has no `id`; controller has no guard metadata.
- [ ] Specs, `lint:arch`; stage.

### Task B5: own entries list (needs B1 only for the result status join; independent of B2-B4) [skip if D15 = no]
- [ ] `RaceEntryDb.listByAthlete(athleteId, limit)` (select whitelist: entry id, division, bib status, race name/date/timezone, result status) in a new method or a small `own-entries` db inside `race-results`; service maps; `GET /race-entries` on a JwtAuthGuard controller; cap 50, newest race first. Specs: only own entries, cap, null result status.
- [ ] Stage.

### Task B6: wiring and cross-cutting checks (after B2-B5)
- [ ] `RaceResultsModule`, `PublicResultsModule` in `app.module.ts`; README endpoint and env notes.
- [ ] Full `npx vitest run`, `npm run lint`, `npm run lint:arch`, `npm run build`. Stage.

### Task B7: real-Postgres smoke (after B6; qa-verifier normally owns)
- [ ] Throwaway Postgres, apply migrations, seed: race with entries covering bib VERIFIED/PENDING and results PENDING/VERIFIED/REJECTED, a banned athlete, an entry with no result. Exercise submit (curl multipart with a real jpg), staff queue/detail/approve/reject, public endpoints unauthenticated. Confirm: REJECTED and banned and unverified-bib rows absent; verified ranked, pending listed unranked; edit of VERIFIED returns it to PENDING and drops the tick; no public response contains photo or link; DB CHECKs reject out-of-range time and inconsistent review fields; `ON DELETE CASCADE` removes the result with its entry.

## Phase 2: Web (starts in parallel with Phase 1, against mocked `fetchImpl`)

### Task F1: helpers (no dependencies)
- [ ] `formatFinishTime(seconds)` -> `h:mm:ss` (hour always shown; specs: 3_725 -> `1:02:05`, 2_709 -> `0:45:09`).
- [ ] `formatRaceDate(iso, timezone)` via `Intl.DateTimeFormat` with `timeZone` (spec: a 23:30 local race does not show next day; invalid timezone falls back to UTC).
- [ ] `divisionLabel(code)` for all 12 codes with raw fallback.
- [ ] `finish-time-input.ts`: `toTotalSeconds({hours,minutes,seconds})` with validation (minutes/seconds 0-59, hours 0-6, within backend bounds) returning `{ ok, value|error }`.
- [ ] `results-types.ts` mirroring the contracts. Run web tests; stage.

### Task F2: public API client (needs F1 types)
- [ ] `createResultsApi({ baseUrl, fetchImpl })`: `listRaces(cursor?)`, `getRace(raceId)`, `listResults(raceId, { division, page })` (page -> offset, page size 50), result type `{ ok:true, value } | { ok:false, status, code }`, network failure -> 502 `request_failed`. Specs: 200, 404 code, fetch throws, param encoding.

### Task F3: public pages (needs F1, F2; independent of F4-F6)
- [ ] `RaceList.svelte`, `DivisionNav.svelte` (`aria-current`), `Leaderboard.svelte`: `<table>` with caption and `scope` headers; verified rows with rank, name, time, tick (icon plus accessible text); separate "Unverified results" section with "Unverified" label and no rank; empty states; prev/next as links. Component specs incl. a name containing `<script>` renders as text, tick present only when `verified`.
- [ ] `results/+page.server.ts` and `results/[raceId]/+page.server.ts` loads: sanitize `division` (default first division from race detail; unknown ignored), `page` int >= 1; 404 -> `error(404)`; other failures -> `error(502)` without backend detail. Load specs with a fake api.
- [ ] Home page "Race results" link (both session states; keep existing home spec green).

### Task F4: athlete API client (needs F1; independent of F2/F3)
- [ ] `result-submit-api.ts`: `submitResult(authedFetch, raceEntryId, { finishTimeSeconds, proofUrl?, photo })` building `FormData` and `PUT` without setting `Content-Type`; `getOwnResult`; `listOwnEntries`. Specs: body is FormData with expected fields, 200/4xx code mapping, and that `createAuthedFetch`'s retry resends a `FormData` body (add a test next to `authed-fetch.spec.ts`; change `authed-fetch` only if it fails).

### Task F5: submit form (needs F1, F4)
- [ ] `ResultSubmitForm.svelte`: h/m/s inputs, file input (jpeg/png/webp, 10 MiB client check, preview via object URL revoked on destroy), optional link, current-status banner (PENDING, VERIFIED with edit warning, REJECTED with reason), "visible once your bib is verified" note when `publicVisible` is false, error-code messages, submit disabled while sending, `aria-live` status region. Component spec per state and per error code.
- [ ] Route `results/submit/[raceEntryId]/+page.svelte` under `AuthGate`.

### Task F6: entries page (needs F4) [skip if D15 = no]
- [ ] `EntryList.svelte` and `account/entries/+page.svelte` under `AuthGate`: each entry with race name, local date, division, bib status, result status, link to the submit route ("Add result" / "Edit result"). Empty state explains that entries are created via race logging (no web UI yet).

### Task F7: manual verification (needs B7 and F3, F5)
- [ ] With backend and seeded data, logged out: `/results`, race page, division switch, pagination, unverified section, 404 for a PENDING-bib-only race; keyboard navigation and screen-reader labels on the tick. Logged in: submit with photo, edit, see statuses; staff approve through the API and see the tick after the 60 s cache.

## Parallelism summary

- Start together: B1 (backend foundation), F1 (helpers). F2-F6 can proceed on mocked fetch in parallel with Phase 1 once the contracts above are frozen.
- After B1, B2, B3, B4, B5 are independent (different directories; each touches only `RaceResultDb`/its own usecase files, except B2 and B3 both add methods to `race-result.db.ts`: assign one builder to those two or have B3 start in a separate file `staff-race-result.db.ts` to avoid conflicts). B6 follows them; B7 last.
- Phase 2: F2+F3 (public) and F4+F5+F6 (athlete) are two independent web streams after F1.
- Sequential integration: B7 and F7 need both phases.

## Follow-ups to file (not in this plan)

- Web UIs for race logging and bib upload (athletes cannot create entries or upload bibs from the browser); staff results-review UI.
- Allow bib upload after race day or another path so post-race entries can become public (D13).
- Real proof-link host list (D6); ToS/Privacy copy covering public display (D18).
- Revoke of VERIFIED bib entries must invalidate public results (HYR-6 deferral).
- Cursor pagination for the staff queue if backlog exceeds 50.
