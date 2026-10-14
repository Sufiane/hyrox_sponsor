# Public Race Results Page (HYR-21) Design

Status: REVISED 2026-10-12 after the product owner approved a changed scope (self-reported finish times). Section 9 lists the decisions still open. The ticket body is empty; everything is derived from the codebase, HYR-5/6/29/33/23 decisions, and the coordinator's scope message.

## 1. Scope

The public page shows race results with finish time. Athletes self-report their total time, attach a photo of the finish clock, and optionally a link to an official result page. Staff review each result. Public visitors see PENDING and VERIFIED results, clearly labelled; only VERIFIED times are ranked.

Replaces the earlier "verified roster, no times" scope (old D1). That reading was forced by the data model, which holds no outcome data: `Race` and `RaceEntry` have no finish time, placement or result fields (`prisma/schema.prisma`). This spec adds that data as a separate table.

Hard rules carried over:
- HYR-6: a bib that staff have not verified is never public. A result is public only if its parent entry's `verification_status` is VERIFIED.
- No auto-verification and no scraping of Hyrox results, ever. The optional link is for the staff reviewer only.

## 2. Data model

New Prisma model `RaceResult`, new enum `RaceResultStatus`. No columns added to `race_entries`.

| Column (`@map`) | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `race_entry_id` | text, UNIQUE, FK to `race_entries`, `ON DELETE CASCADE` | 1:1 with the entry |
| `finish_time_seconds` | integer NOT NULL | whole seconds; bounds in D8 |
| `proof_photo_key` | text NOT NULL | private storage key, `race-results/{raceEntryId}/{uuid}.{ext}` |
| `proof_url` | text NULL | https on an allowlisted host (section 5.4) |
| `status` | enum `race_result_status` PENDING / VERIFIED / REJECTED, default PENDING | own lifecycle, independent of the bib status |
| `rejection_reason` | text NULL | needed so an athlete learns why (HYR-33 reject takes a reason); not in the coordinator's column list, see D12 |
| `reviewed_by` | text NULL | staff id as a plain string, same as `race_entries.verified_by` |
| `reviewed_at` | timestamptz NULL | |
| `submitted_at` | timestamptz NOT NULL | bumped on every create/edit; doubles as the reviewer's optimistic-concurrency token |
| `created_at`, `updated_at` | timestamptz | |

Naming: the coordinator wrote `race_result`; every existing table is plural (`race_entries`, `athletes`). Default here: `race_results` for consistency (D11). Enum type `race_result_status`; model `RaceResult`; relation `RaceEntry.raceResult RaceResult?`.

Hand-written migration SQL (Prisma cannot express these; use mapped names):
- CHECK `finish_time_seconds` between the D8 min and max.
- CHECK `proof_url IS NULL OR proof_url LIKE 'https://%'` (defence in depth; the allowlist stays in app config).
- CHECK review fields consistent: PENDING implies `reviewed_by`, `reviewed_at`, `rejection_reason` all NULL; VERIFIED and REJECTED imply `reviewed_by` and `reviewed_at` NOT NULL; only REJECTED may have `rejection_reason`.
- Index `(status, submitted_at)` for the staff queue; index on `race_entry_id` is the unique constraint.

Branded types (project rule: brand domain primitives in `src/common/`, validating constructors, cast only in `*.db.ts`):
- `Seconds` (`src/common/seconds.ts`): `seconds(value)` requires a positive integer; `MIN_FINISH_SECONDS`/`MAX_FINISH_SECONDS` constants; error code `seconds_invalid` / `finish_time_out_of_range`. Used for `finishTimeSeconds` everywhere in backend signatures.
- `ResultProofKey` (`src/common/result-proof-key.ts`): its own pattern `^race-results/[a-z0-9]+/[0-9a-f-]{36}\.(jpg|png|webp)$` plus `buildResultProofKey(raceEntryId, extension)`. Deliberately NOT a loosening of `DOCUMENT_KEY_PATTERN`: that regex guards bib documents, and widening it risks the HYR-6 paths and lets a bib key be passed where a result key is expected. Images only (no PDF for a clock photo).
- `RaceResultId`, `RaceId` constructor (the `RaceId` type exists, its constructor does not) in `src/common/ids.ts`.
- `ProofUrl` (`src/common/proof-url.ts`): validated https URL string, constructed via the allowlist policy.

## 3. Lifecycle

```
(no row) --athlete submit--> PENDING --staff approve--> VERIFIED
                               |  ^                        |
                               |  +----athlete edit--------+   (any edit of time, photo or link resets to PENDING)
                               +--staff reject--> REJECTED --athlete resubmit--> PENDING
```

- Athlete submit is an upsert on `race_entry_id`. Create requires time and photo. Edit may change time, link, and/or photo; omitting the photo keeps the existing one (D9), while omitting the link clears it (PUT replaces everything except the photo; coordinator-approved). Any edit, including of a VERIFIED result, sets status PENDING, clears `reviewed_by`, `reviewed_at`, `rejection_reason`, and bumps `submitted_at`. Replaced photos are deleted from storage after the row update commits (best-effort, as HYR-6 does).
- Staff approve/reject is a conditional update `WHERE id = ? AND status = 'PENDING' AND submitted_at = :expected`. Zero rows updated leads to a lookup that distinguishes 404 `race_result_not_found`, 409 `result_not_pending`, 409 `result_changed` (the athlete edited after the reviewer loaded it). Same shape as the HYR-6 review usecase.
- Submit eligibility (all 4xx are snake_case codes, readable detail logged at the throw site):
  - entry exists and belongs to the athlete: else 404 `race_entry_not_found`;
  - athlete not banned: else 403 `athlete_banned`;
  - race date has passed (`race.date <= now`): else 409 `race_not_finished`;
  - file present, non-empty, within `MAX_DOCUMENT_BYTES` (10 MiB, same limit as bib documents), sniffed as jpeg/png/webp: else 400 `proof_photo_missing` / `proof_photo_too_large` / `proof_photo_type_unsupported`;
  - time within bounds: 400 `finish_time_out_of_range`;
  - link policy: 400 `proof_url_invalid` (not https, userinfo present, too long, unparsable) or `proof_url_host_not_allowed`.
- The bib status does NOT gate submission, only public visibility. Interaction to know about: HYR-6 refuses bib uploads once the race date has passed (`race_already_started`), so an entry whose bib was not verified before race day can never become public, and its result will sit invisible. The submit response and the athlete's own GET therefore include `publicVisible: boolean` and the bib status so the UI can say "your result will appear once your bib is verified". See D13.

## 4. Privacy and PII analysis

Public payload per result row: display name ("First L."), division, finish time in seconds, `rank` (verified only), `verified` boolean. Nothing else.

| Data | Public? | Notes |
|---|---|---|
| `proof_photo_key` and any photo URL | Never | May show faces, other people, bib, location context. Staff-only via 5-minute signed URL, `Cache-Control: no-store` (same as HYR-33). |
| `proof_url` | Never | Staff-only. Athlete-controlled link a staff member will open, so https plus exact host allowlist; shown to staff as text with `rel="noopener noreferrer"` if rendered. |
| `rejection_reason`, `reviewed_by`, `reviewed_at`, `submitted_at` | Never public | The athlete sees their own reason; reviewer id is staff PII. |
| `Athlete.name` | "First L." | Default retained. |
| `Athlete.email`, hash, Stripe, trust, strikes, ban flag, `isAdult`, ToS fields | Never | |
| `bibNumber` | Not exposed | Default retained (hidden). |
| athlete / entry / result ids | Not exposed | Default retained. Public race ids are exposed (needed for URLs). |
| finish time | Yes, with name | New personal data: athletic performance tied to a (partial) real name. Not a special category, but permanent once cached/scraped. |

New risks created by showing PENDING rows:
- A self-reported, unreviewed time is public immediately once the bib is verified. An athlete can post a false time under their own name, and false times can sit visible for as long as the review backlog (HYR-33's queue is capped at 50, so backlog is real). Mitigations: unverified rows are listed below the leaderboard, unranked, with an explicit "unverified" label; time bounds (D8); the existing global throttle plus the submit endpoint's own tighter throttle (D14); staff queue. The coordinator accepted showing PENDING; this note records the trade-off and that a fabricated time cannot be unpublished faster than staff act.
- Edits to a VERIFIED result drop it from the leaderboard and the tick until re-review (the old verified time is not retained anywhere publicly). That is the approved behavior; the cost is a verified athlete temporarily disappearing from the ranking.
- Ranking integrity: rank counts VERIFIED only, so fake PENDING times never displace verified athletes.
- Scraping: unauthenticated list of names and times is scrapable. Pagination caps, global throttle (60/min/IP), no dump endpoint, no athlete-centric view.
- Banned athletes (`is_banned`) are excluded from all public queries; banning hides their results without deleting them.
- Late reject/ban/edit propagation is bounded by the 60 s public cache TTL.
- Consent / ToS (HYR-23): the project memory records that signup now records ToS acceptance, copy is PLACEHOLDER, and the owner decided to go live without legal review (not to be re-raised as a blocker). Whether the placeholder copy mentions public display of name and self-reported times could not be verified: HYR-23's code (`web/src/lib/legal/terms.ts`, `athletes.tos_accepted_at`) is not in this worktree. Action: when the HYR-23 copy is next edited, add a sentence covering public display of "first name + initial and race results"; that is a copy edit plus a `TOS_VERSION` bump in both places, no new plumbing. There is no re-acceptance flow, so existing accounts are not re-prompted. Default retained: no per-athlete consent flag.
- Proof photo handling: stored as-is (EXIF/GPS stays in the object, readable by staff only). Not stripping is acceptable because the object is never public; revisit if photos ever become visible beyond staff.

## 5. Backend design

### 5.1 Module layout (hexagonal, usecases where warranted)

Two modules, both new, following the HYR-5/6 structure:

`src/race-results/` (athlete + staff, authenticated):
- `race-result.service.ts`: thin delegates plus the staff signed-URL read; no ORM.
- `race-result.db.ts`: only ORM importer for simple reads (own result lookup, staff queue, staff detail lookup). No domain throws.
- `usecases/submit-race-result/`: `submit-race-result.usecase.ts` + `.usecase.db.ts` + `.module.ts` + input type. Warranted: storage put, eligibility rules, upsert with reset, cleanup of replaced photo, several private helpers. Mirrors `submit-verification-document`.
- `usecases/review-race-result/`: same split. Warranted by precedent (`review-verification`) and the three-way miss analysis.
- `proof-url-policy.ts` + spec: pure `parseProofUrl(raw, allowedHosts): ProofUrl`.
- `race-result.controller.ts` (athlete, `JwtAuthGuard`), `staff-race-result-review.controller.ts` (`StaffGuard`), DTOs, `race-results.module.ts`.

`src/public-results/` (unauthenticated, read-only): `public-results.controller.ts`, `.service.ts`, `.db.ts`, DTOs, `race-cursor.ts`, `display-name.ts`. No usecase layer (simple reads). Kept separate so the unauthenticated surface is auditable in one place; imports `PrismaModule` only.

No existing db is reused: `RaceEntryDb` exposes document keys; the new dbs are intentionally narrow.

### 5.2 Storage reuse

Reusable as-is: `DocumentStorage` port and its S3/MinIO adapter, `StorageModule`, the private bucket, `detectDocumentType` (magic-byte sniffing), `MAX_DOCUMENT_BYTES`, the multipart `FileInterceptor` pattern, 5-minute signed GET.

One small change: the port's methods are typed with `DocumentKey`. Widen to `DocumentKey | ResultProofKey` (a type-only union in `document-storage.ts`; the S3 adapter already treats keys as strings). `DOCUMENT_KEY_PATTERN` and `buildDocumentKey` are untouched, so the bib flow is unchanged. Alternative (rejected unless owner prefers): store result photos under the existing `race-entries/` prefix and reuse `DocumentKey`; cheaper, but one entry then holds two unrelated documents under one brand and the review code could sign the wrong one.

### 5.3 Endpoints

Athlete (JwtAuthGuard, `athleteId` only from the token):
- `PUT /race-entries/:raceEntryId/result` multipart: field `photo` (file), `finishTimeSeconds` (int, form field), `proofUrl` (optional). Create or replace. 200 `{ raceEntryId, status: 'PENDING', submittedAt, publicVisible }`. Multipart numbers arrive as strings: DTO transforms with the `seconds()` constructor.
- `GET /race-entries/:raceEntryId/result` own result: `{ status, finishTimeSeconds, proofUrl, hasPhoto, rejectionReason, submittedAt, reviewedAt, publicVisible, bibVerificationStatus }`; 404 `race_result_not_found` when none.
- `GET /race-entries` (own entries list, new; see D15): `{ items: { raceEntryId, raceName, raceDate, timezone, division, bibVerificationStatus, resultStatus | null }[] }`, cap 50. Without it the web submit form has no way to find an entry id, and no web UI creates entries (section 6).

Staff (StaffGuard, `@CurrentStaffId()`; prefix `staff/race-results`, mirroring `staff/race-entries`):
- `GET staff/race-results` queue: PENDING results, oldest `submitted_at` first, hard cap 50, items `{ raceResultId, athleteName, raceName, raceDate, division, finishTimeSeconds, hasProofUrl, submittedAt }`. Only for entries whose parent bib is... all PENDING results regardless of bib status (staff can approve a result before the bib; it just is not public yet). See D16.
- `GET staff/race-results/:raceResultId` detail for side-by-side review: `{ raceResultId, athleteName, raceName, raceDate, division, finishTimeSeconds, proofUrl, photoUrl (signed, 5 min), photoUrlExpiresAt, submittedAt }`, `Cache-Control: no-store`. Time, photo and link in one response is the "side by side" contract; there is no staff web UI (none exists; HYR-33 is API-only), so the layout is a future staff-UI concern.
- `POST staff/race-results/:raceResultId/approve` body `{ submittedAt }`, 204.
- `POST staff/race-results/:raceResultId/reject` body `{ submittedAt, reason }` (trimmed 1-500), 204.
- Separate from the bib queue: different path, db, usecase, status.

Public (no guards; `Cache-Control: public, max-age=60`):
- `GET /public/races?limit&cursor`: races with at least one public result. Response `{ items: { id, name, location, date, timezone, resultCount, verifiedCount }[], nextCursor }`. Keyset on `(date desc, id desc)`, limit default 20 max 50.
- `GET /public/races/:raceId`: `{ id, name, location, date, timezone, divisions: { division, resultCount, verifiedCount }[] }`; 404 `race_not_found` when missing or no public result.
- `GET /public/races/:raceId/results?division=&limit&offset`: `division` REQUIRED (rank is per division). `{ items: { rank: number | null, displayName, finishTimeSeconds, verified: boolean }[], total, verifiedTotal }`. Order: VERIFIED by `finish_time_seconds asc`, then `displayName`, then result id (stable); then PENDING by time asc, name, id. `limit` default 50 max 100, `offset` max 10_000.

Public visibility predicate (single shared definition in the public db, used by every public query): `result.status IN (PENDING, VERIFIED) AND entry.verification_status = 'VERIFIED' AND athlete.is_banned = false`. Entries with no result row are naturally absent. REJECTED never.

### 5.4 Proof link policy

`RESULT_PROOF_URL_HOSTS`: comma-separated host list in env, parsed like `CORS_ORIGINS`, validated in `env.validation.ts`, documented in `.env.example`. Host is unknown today, so the default is an EMPTY list, meaning links are refused with 400 `proof_url_host_not_allowed` until it is filled before launch (D6). Rules: `new URL(raw)`, protocol exactly `https:`, no username/password, default port only, `hostname` lower-cased and exactly equal to a listed host (no wildcard subdomain matching unless the owner lists them), length at most 500, trimmed; empty string is treated as absent.

### 5.5 Ranking without raw SQL

No raw SQL exists in the repo and mocked db specs cannot validate it, so ranking is computed in the service from Prisma queries: db methods `countVerifiedFasterThan(raceId, division, seconds)`, `listVerified(raceId, division, offset, limit)`, `listUnverified(...)`, `countByStatus(...)`. The service stitches verified-then-unverified across pages. Rank = competition ranking (1, 2, 2, 4): the first row on a page takes `1 + countVerifiedFasterThan(its time)`, later rows keep the previous rank on equal time, otherwise take `offset + index + 1`. Pure logic, unit-testable with mocks.

### 5.6 Errors, throttling, testing

- Errors: snake_case codes through the existing `DomainError` classes and filter; readable text with ids logged by class `Logger`; no names, photo keys or URLs in logs.
- Throttle: global 60/min stays for public and staff; the submit endpoint gets a tighter `@Throttle` (D14).
- Tests (Vitest, nested `describe` per condition, mocked prisma like existing db specs): `seconds`, `result-proof-key`, `proof-url-policy` (userinfo trick `https://allowed.example@evil.test` rejected, http rejected, host case, empty allowlist), submit usecase (new, edit of PENDING, edit of VERIFIED resets, edit of REJECTED, banned, race not finished, wrong owner, bad file types including PDF, oversize, storage failure cleanup, row-update race), review usecase (approve, reject without reason, not pending, changed since load, not found), public service (ranking incl. ties and page boundaries, verified-then-unverified stitching, 404 rules, name formatting), contract specs asserting the exact public key set and that no public response contains `proof`, `photo`, `email`, `id` fields, and that public controllers carry no guard metadata. Real-Postgres smoke in the final task.

## 6. Frontend design

State of the web today (checked): routes are `/`, `/login`, `/signup`, `/dev/body-map`, and the BFF `/session/*`. There is NO web UI for logging a race entry (HYR-5 is API-only), none for uploading a bib document (HYR-6 API-only), none for viewing one's entries, and no staff UI. Authenticated browser calls to the backend go through `createAuthedFetch` with a bearer token held in memory (floor-price panel pattern); `authed-fetch` retries once with the same `init`, so a `FormData` body (re-sendable, unlike a stream) is fine but should be covered by a test.

Consequence: an athlete cannot get a race entry through the web. The Phase 2 submit form is only reachable for entries created via the API until race logging and bib upload get web UIs (separate tickets, out of scope; D15/D17). This does not block the public pages.

Public pages (server-rendered `+page.server.ts`, no CORS, no session):
- `/results`: race list with result and verified counts, cursor "next page" link.
- `/results/[raceId]`: header (date formatted in the race's own timezone with `Intl`), division navigation with counts, leaderboard table for the selected division (default: first division). Verified rows: rank, name, time `h:mm:ss`, a "verified" tick (icon plus visible text/`aria-label`, never colour alone). Below, under a heading "Unverified results", the pending rows: no rank, label "Unverified", time. Paging via `?division=&page=` plain links.
- Time formatting helper `formatFinishTime(seconds)` -> `h:mm:ss` (web-local, tested). Division labels map for the 12 codes.
- All athlete/race strings rendered as text only, never `{@html}`. Root layout's `session.bootstrap()` still runs; public routes have no `AuthGate`.

Athlete submit (authenticated, client-side via authed fetch):
- `/results/submit/[raceEntryId]`: guarded by `AuthGate`; shows current state (GET own result: status, reason if rejected, "visible once your bib is verified" note), form with hours/minutes/seconds inputs converted to total seconds, photo file input (accept jpeg/png/webp, 10 MiB client pre-check, preview), optional link input. Posts `FormData` with `PUT`. Maps error codes to messages (`finish_time_out_of_range`, `proof_photo_*`, `proof_url_*`, `race_not_finished`, `athlete_banned`). Warns that editing a verified result sends it back to review.
- `/account/entries` (only if D15 default accepted): list from `GET /race-entries` with a "Add result" / "Edit result" link per entry.

Staff review UI: not built (no staff web exists); staff use the API (curl or tooling) per HYR-33 precedent.

## 7. Phasing and parallelism

Phase 1, backend (all in the plan, Tasks B1 to B7). B1 (foundations: schema, migration, brands, storage union, env config, proof-url policy) is the shared base. After B1, these are mutually independent and can go to parallel builders: B2 athlete submit/get, B3 staff review, B4 public endpoints, B5 own-entries list. B6 is the module wiring and cross-cutting contract tests; B7 the real-Postgres smoke.

Phase 2, web (Tasks F1 to F6): F1 shared helpers, F2 public API client, F3 public pages, F4 athlete API client, F5 submit form, F6 own-entries page. F2/F3 depend only on the public contract; F4/F5/F6 only on the athlete contract. All web tasks can start in parallel with Phase 1 against mocked `fetchImpl` once the contracts in the plan are fixed; they integrate in the manual verification task.

Public pages (F1-F3) are the user-visible deliverable; the athlete submit form (F4-F6) is the part limited by the missing race-logging UI (section 6).

## 8. Out of scope

- Web UIs for race logging, bib upload, staff review (separate tickets); a staff results-review UI.
- Retaining or showing the previously verified time while an edit is pending.
- Scraping or auto-importing from Hyrox, link content fetching, OCR of the clock photo.
- Athlete profile pages, search by name, cross-race history.
- Revoking VERIFIED bib entries (HYR-6 deferred); the 60 s TTL covers it when it lands.
- Per-athlete consent flag, Privacy Policy, ToS re-acceptance.

## 9. Decisions

Closed by the coordinator's message: self-reported times with required clock photo; `race_result` 1:1 table with own status lifecycle; photo and link staff-only; staff review endpoints separate from the bib queue, 204 style, StaffGuard; edit of VERIFIED resets to PENDING; public shows PENDING and VERIFIED with a `verified` flag, REJECTED hidden; bib must be VERIFIED; banned excluded; rank on VERIFIED only; race public if it has any public result; entries without a result hidden; "First L.", no bib, no ids, no consent flag, global throttle, 60 s cache, routes as before.

Still open (each with the default the plan assumes):
- D6 (needed before launch): the proof-link host allowlist value. Default: empty env list, links refused until filled.
- D8: finish-time bounds. Default: min 1_800 s (30 min), max 21_600 s (6 h), enforced in code and by a DB CHECK. Pro elite doubles/relay can be fast; confirm the floor.
- D9: edit without re-uploading the photo keeps the old photo (but still resets to PENDING). Default: yes.
- D11: table name `race_results` (plural, consistent) vs `race_result`. Default: plural.
- D12: add `rejection_reason` column (not in the coordinator's list). Default: yes; without it a rejected athlete gets no explanation.
- D13: bib not verified before race day makes a result permanently invisible (HYR-6 blocks post-race bib upload). Default: allow submission, show `publicVisible: false` and an explanation. Real fix (allow bib upload after the race) is a HYR-6 change, out of scope; owner should decide whether to schedule it.
- D14: tighter throttle on result submit. Default: 10/min per client.
- D15: add authed `GET /race-entries` and a web `/account/entries` page so the submit form has an entry point. Default: yes, small. Alternative: deep-link only.
- D16: staff queue includes PENDING results whose bib is not yet verified. Default: yes (staff may approve early; visibility still gated).
- D17: accept that the web submit flow is unusable end-to-end until race-logging and bib-upload UIs exist, or build those first. Default: accept; public pages and submit form ship, UIs are follow-up tickets.
- D18: ToS copy: add a public-display sentence to the HYR-23 draft terms. Default: yes as a copy edit when HYR-23 lands; not a blocker.
- D19: HYR-21 builds on code that is not in this worktree: HYR-33 (staff review controller pattern) and HYR-23 (ToS) sit on branches that currently point at the same commit as HEAD, i.e. unmerged or not yet committed here. Default: mirror the HYR-33 pattern from `RaceEntryVerificationController` plus `StaffGuard` (present); rebase onto them if they land first.
- D20: leaderboard requires `division` param and shows one division at a time. Default: yes.
- Retained from the earlier draft, unchanged: "First L." names, no bib, no ids, no consent flag, global throttle, backend URL via `VITE_API_BASE_URL`, routes as stated, 60 s cache.
