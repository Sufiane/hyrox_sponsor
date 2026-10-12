# HYR-23: Terms of Service page and acceptance at signup - Design

Status: scope agreed with the product owner; implementation decisions in section 6 resolved by the planner and open to override. Follows HYR-3 (athlete auth, `adult_attestation_required` gate) and HYR-30 (web signup via BFF). Full-stack: shared constant, backend, web.

## 1. Context and findings

- Signup today: `SignupForm.svelte` has one "I am 18 or older" checkbox. `validateSignup` (`web/src/lib/auth/validation.ts`) checks it client-side, `session.signup` -> `auth-api` -> BFF `POST /session/signup` (`session-handlers.ts` `parseSignup`, requires `adultAttested` boolean) -> `backend-auth.ts` `post('/auth/signup')` -> `SignupDto` (`adultAttested` is `@IsOptional @IsBoolean`) -> `AuthService.signup` -> `AthleteService.assertAdultAttested` then `AthleteService.register` (asserts again, stamps `adultAttestedAt = new Date()`) -> `AthleteDb.create` (`isAdult: true`).
- The gate is service-level and optional-at-DTO on purpose: a missing field reaches the service and becomes the domain code `adult_attestation_required` (400) rather than a generic `validation_failed`. The new gate copies this.
- DB: `athletes.adult_attested_at` is nullable `Timestamptz(3)`, with a hand-written CHECK (`athletes_adult_attestation_consistent`) in the `add_athlete_auth` migration. Existing athlete rows have no ToS acceptance.
- Web and backend share constants through the `@hyrox-sponsor/shared` workspace (`shared/src/*.ts`, exported as `./*`). The backend cannot import it at runtime (`tsconfig.build.json` has `rootDir: src`), so the established pattern (floor price, body zones) is: a duplicate constant in `src/` plus a `*-contract.spec.ts` in `src/` that imports the shared module and asserts equality.
- Web has no `hooks.server`/route guards; a new route under `web/src/routes/terms/` is public by default. Layout calls `session.bootstrap()` for every page, harmless on a static page.
- `toPublicAthlete` exposes only id, name, email, isAdult. ToS fields stay off it.
- Repo conventions binding this work: hexagonal service/db split, explicit return types, snake_case error codes with detail logged, branded domain primitives with validating constructors in `src/common`, no barrel files, nested `describe` per condition in Vitest, Prisma `@map` snake_case, exact version pins (no new deps expected).

## 2. Goal and non-goals

Goal: a public `/terms` page renders draft ToS copy from one swappable source; signup requires an explicit ToS checkbox linking to it; the backend refuses signup without acceptance of the current version and persists `tosAcceptedAt` (server clock) and `tosVersion` on the athlete.

Non-goals: Privacy Policy; forced re-acceptance when `TOS_VERSION` changes (only the version is stored); backfilling existing athletes; acceptance history table; exposing ToS fields via `/auth/me`; lawyer review or launch-blocker gating (product owner will go live on draft copy); i18n of the copy; rendering markdown (copy is structured data).

## 3. Approaches considered

### 3.1 One checkbox or two (decision D1)

1. **Two separate checkboxes. Chosen.** "I am 18 or older" stays as is. A new "I agree to the Terms of Service" sits directly below it, with "Terms of Service" a link to `/terms`. Reasons: the 18+ attestation is a factual eligibility declaration with its own column, boolean and error code; the ToS is contractual consent with a version. Combining them would make a single boolean ambiguous in the audit trail (what did the user actually assert?), force one error message to cover two failures, and mean touching the already-hardened `adultAttested` contract. Separate boxes also make it impossible for a minor to "agree to terms" and thereby imply attestation. Cost: one more click at signup, acceptable for a marketplace with binding bids.
2. One combined checkbox ("I am 18+ and agree to the Terms"). Fewer clicks but the problems above; rejected.

### 3.2 What the client sends (D2)

1. **`tosVersion: string` (the version the user was shown). Chosen.** The web sends `TOS_VERSION` only when the box is checked. Server compares to its own current version. Reasons: records exactly which text was accepted, detects a stale open tab (page rendered under an older version) instead of silently stamping the new version, and needs no separate boolean. Missing field = not accepted.
2. `tosAccepted: boolean` and the server stamps its own current version. Simpler payload, but a user who ticked the box on a stale page would be recorded as accepting text they never saw. Rejected.
3. Both boolean and version. Redundant. Rejected.

### 3.3 Keeping web and backend versions in sync (D3)

1. **Shared constant plus backend duplicate guarded by a contract spec. Chosen.** `shared/src/tos-version.ts` exports `TOS_VERSION`; `web/src/lib/legal/terms.ts` re-uses it for the page and the form; `src/common/tos-version.ts` holds a duplicate; `src/common/tos-version-contract.spec.ts` fails CI if they diverge. Matches the floor-price and body-zone precedent and needs no build change.
2. Backend imports shared at runtime. Requires changing `rootDir`/build and tsc-alias; out of proportion. Rejected.
3. Backend exposes `GET /legal/tos-version` and web fetches it. Adds a network dependency to render a static page. Rejected.

Bumping the version is therefore a two-line change (shared + backend) and CI catches a missed one.

### 3.4 Where the copy and draft marker live (D4)

`web/src/lib/legal/terms.ts` exports structured data: `TOS_TITLE`, `TOS_EFFECTIVE_NOTE`, `TOS_SECTIONS: { id: string; heading: string; paragraphs: string[] }[]`, and `TOS_DRAFT_NOTICE: string | null` (`TOS_VERSION` is not re-exported here; callers import it from `@hyrox-sponsor/shared/tos-version` directly, no barrel). The `/terms` page renders a visible banner whenever `TOS_DRAFT_NOTICE` is non-null. Replacing the draft with reviewed copy = edit `TOS_SECTIONS`, set `TOS_DRAFT_NOTICE = null`, bump `TOS_VERSION` in both places. No feature flag, no env var, no launch gating.

## 4. Design

### 4.1 Data model

Prisma `Athlete` gains:

- `tosAcceptedAt DateTime? @map("tos_accepted_at") @db.Timestamptz(3)`
- `tosVersion String? @map("tos_version")`

New migration `prisma/migrations/<timestamp>_add_athlete_tos_acceptance/migration.sql`: two `ALTER TABLE athletes ADD COLUMN` (nullable, no default, so existing rows stay null) plus a hand-written CHECK `athletes_tos_acceptance_consistent` as `(tos_accepted_at IS NULL) = (tos_version IS NULL)`, mirroring the adult-attestation constraint. The CHECK is a cross-layer invariant the reader cannot see from `schema.prisma`; add a one-line comment in the migration, not in TS.

### 4.2 Backend

- `src/common/tos-version.ts`: `TosVersion = Brand<string, 'TosVersion'>`, `CURRENT_TOS_VERSION: TosVersion`. No ORM import, no logging.
- `AthleteService`:
  - `assertTosAccepted(tosVersion: string | undefined): TosVersion`. If `undefined`: warn-log, `BadRequestException('tos_acceptance_required')`. If defined and not equal to `CURRENT_TOS_VERSION`: warn-log (include received and current version), `BadRequestException('tos_version_mismatch')`. Otherwise returns `CURRENT_TOS_VERSION` (the branded value, so only validated values reach the db).
  - `register` input gains `tosVersion: string | undefined`. It calls `assertAdultAttested`, then `assertTosAccepted`, builds one `const now = new Date()` and passes `adultAttestedAt: now`, `tosAcceptedAt: now`, `tosVersion`.
- `AthleteDb.create` data type gains `tosAcceptedAt: Date; tosVersion: TosVersion`. Prisma `Athlete` type picks up the new columns automatically; no change to `toPublicAthlete`.
- `SignupDto`: `@IsOptional() @IsString() @Length(1, 64) tosVersion?: string;`. A wrong type is a 400 `validation_failed` (consistent with `adultAttested`).
- `AuthService.signup`: input gains `tosVersion?: string`; calls `assertAdultAttested` then `assertTosAccepted` before hashing (so a rejected signup does not burn an argon2 hash), and forwards `tosVersion` to `register`.
- Error order for a request missing both: `adult_attestation_required` first (deterministic, tested).
- No controller change (DTO is passed through whole).

### 4.3 Shared

`shared/src/tos-version.ts`: `export const TOS_VERSION = '2026-10-10-draft';` plus a `shared/src/tos-version.spec.ts` asserting it is a non-empty trimmed string of at most 64 chars (the DTO bound).

### 4.4 Web

- `web/src/lib/legal/terms.ts`: copy and draft notice (4.5 for content outline).
- `web/src/routes/terms/+page.svelte`: public page. `<svelte:head><title>Terms of Service</title>`, `<main>` with h1, draft banner (`role="note"`) when `TOS_DRAFT_NOTICE != null`, version line, each section as `<section aria-labelledby>` with `<h2>` and paragraphs, link back to `/signup`. Styling follows existing pages (`mx-auto max-w-... p-6`, slate text); no new classes file.
- `SignupForm.svelte`: new `tosAccepted = $state(false)`; second checkbox block cloned from the adult block, `id`s `signup-tos-error`; label text "I agree to the " + `<a href="/terms" target="_blank" rel="noopener">Terms of Service</a>`. The link is inside the `<label>`; clicking it must not toggle the box (a link click inside a label does not toggle; test it). Opens in a new tab so entered form data is not lost. Submit passes `tosVersion: TOS_VERSION` (box is validated checked before reaching the API).
- `validation.ts`: `SignupFormInput.tosAccepted: boolean`; `validateSignup` adds `['tosAccepted', input.tosAccepted ? null : 'You must agree to the Terms of Service.']`.
- `auth-types.ts`: `SignupInput` gains `tosVersion: string`.
- `auth-errors.ts`: `tos_acceptance_required: 'You must agree to the Terms of Service.'`, `tos_version_mismatch: 'The Terms of Service were updated. Reload the page and agree again.'`.
- `session-handlers.ts` `parseSignup`: require `typeof body.tosVersion === 'string'`, forward it. A missing/non-string value is a BFF `validation_failed` 400 (the web client always sends it; direct API clients hit the backend gate instead).
- `backend-auth.ts` needs no code change (forwards `SignupInput` whole); its spec fixtures update.
- No change to `session.svelte.ts` (passes `SignupInput` through).

### 4.5 Draft copy outline

Title "Terms of Service". Banner text: "DRAFT - not legal advice. Placeholder terms pending review." Sections (ids in parentheses): About these terms (about); Eligibility, 18+ (eligibility); Accounts (accounts); Not affiliated with Hyrox (trademark); How sponsorship auctions work, including body zones (auctions); Bids are binding (bids); Payments, escrow and refunds (payments); Athlete obligations and proof of sponsorship (obligations); Disputes (disputes); Limitation of liability (liability); Changes to these terms (changes); Contact (contact). Each section is 1-3 short plain-language placeholder paragraphs. Where a business rule is not yet defined in the product (refund windows, fees), the copy says so generically ("as described at checkout") rather than inventing numbers.

### 4.6 Error contract

| Condition | Where | Status | Code |
|---|---|---|---|
| `tosVersion` absent | backend service | 400 | `tos_acceptance_required` |
| `tosVersion` not the current version | backend service | 400 | `tos_version_mismatch` |
| `tosVersion` wrong type or length | backend DTO pipe | 400 | `validation_failed` |
| `tosVersion` absent/non-string | BFF | 400 | `validation_failed` |
| box unchecked | web form | - | inline field error |

## 5. Testing

Vitest, nested `describe` per condition.

- shared: `tos-version.spec.ts`.
- backend: `tos-version-contract.spec.ts` (shared equals backend); `athlete.service.spec.ts` (`assertTosAccepted` three branches, `register` passes `tosAcceptedAt === adultAttestedAt` and `tosVersion` to db, rejects before db call when missing/mismatched, adult gate wins when both missing); `auth.service.spec.ts` (propagates both codes, does not hash when rejected, forwards `tosVersion` to `register`); `validation-pipe.spec.ts` (valid payload gains `tosVersion`; wrong type rejected). Existing attestation tests updated for the new required input field.
- web: `validation.spec.ts`; `auth-errors.spec.ts`; `SignupForm.spec.ts` (checkbox required, link href `/terms`, submits `tosVersion: TOS_VERSION`, link click does not tick the box); `session-handlers.spec.ts` and `backend-auth.spec.ts` (forward, reject when missing); `session.spec.ts` and `auth-api.spec.ts` fixtures; `terms/+page.spec.ts` (renders heading, every section heading from `TOS_SECTIONS`, draft banner shown when notice non-null and hidden when null, version shown); a `terms.spec.ts` sanity test (unique section ids, no empty paragraphs, covers required topic ids).
- Migration: verify by `prisma migrate dev`/`migrate deploy` against local DB (port 5435) and `prisma generate`; no automated DB test exists for the adult CHECK either.

## 6. Decisions resolved by the planner (override if disagree)

1. Separate ToS checkbox, not combined (3.1).
2. Client sends `tosVersion` string; no boolean (3.2).
3. Shared constant + backend duplicate + contract spec (3.3).
4. Second error code `tos_version_mismatch` beyond the requested `tos_acceptance_required`, so a stale-tab user gets a useful message instead of "you must agree" on a checked box.
5. DB columns nullable with a both-or-neither CHECK; existing athletes stay null.
6. `TOS_VERSION` initial value `2026-10-10-draft`.
7. Draft marker is a nullable constant `TOS_DRAFT_NOTICE` rendered as a banner; set to `null` to remove.
8. ToS fields not added to `PublicAthlete`/`/auth/me`.
9. Link opens in a new tab.
10. BFF requires `tosVersion` (strict), matching how it treats `adultAttested`.

## 7. Risks

- Going live on unreviewed draft copy is the product owner's explicit call. The banner makes the draft status visible to users; no further gating.
- Version drift between shared and backend is caught by the contract spec only if CI runs it; it is part of the normal `npm test`.
- Rolling deploy: the validation pipe uses `forbidNonWhitelisted: true`, so a new web build against an old backend gets `validation_failed` on signup; an old web build against the new backend gets `tos_acceptance_required`. Either way signup is briefly broken for the mismatched pair. Deploy backend first, then web, back to back.
