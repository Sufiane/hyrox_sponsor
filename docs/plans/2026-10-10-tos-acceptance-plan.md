# HYR-23 ToS page and acceptance - Implementation Plan

Spec: `docs/specs/2026-10-10-tos-acceptance-design.md`. Read it first; section numbers below refer to it.

Goal: public `/terms` page, ToS checkbox at signup, backend gate `tos_acceptance_required` / `tos_version_mismatch`, persisted `tosAcceptedAt` + `tosVersion`.

Conventions for every task (from the user's global rules): TDD (failing test, see it fail, implement, see it pass); explicit return types on backend functions; no single-letter names; braces on every `if`; blank line before `if/for/return/throw`; `readonly` ctor params; numeric separators on 5+ digit literals; snake_case error codes with detail in `Logger`; no barrel files; no comments unless a non-obvious why; Vitest nested `describe` per condition (`when ...`), short `it` titles; exact version pins (no new deps expected). Commits: conventional commits, one per task, `Co-Authored-By` trailer per the session attribution. Do not commit at the end; stage and stop for `/crit` review.

Run commands from the repo root. Backend tests: `npx vitest run <path>`. Web tests: `npm test -w web -- <path>`. Shared: `npm test -w shared`. Lint: `npm run lint`; arch: `npm run lint:arch`; web types: `npm run check -w web`.

Parallelism: Task 1 (shared) must land first. After it, Tasks 2-5 (backend) and Tasks 6-9 (web) are independent and can run in parallel. Task 10 is the final cross-check.

---

## Task 1: Shared ToS version constant

Files: create `shared/src/tos-version.ts`, `shared/src/tos-version.spec.ts`.

- [ ] Write spec first (model on `shared/src/floor-price.spec.ts`): `describe('TOS_VERSION')` -> `describe('when read')` -> `it('is a trimmed, non-empty string of at most 64 characters')`.
- [ ] Run `npm test -w shared`; confirm failure (module missing).
- [ ] Create `export const TOS_VERSION = '2026-10-10-draft';`.
- [ ] Run `npm test -w shared`; confirm pass. Commit `feat(shared): add tos version constant`.

## Task 2: Backend version constant and contract spec

Files: create `src/common/tos-version.ts`, `src/common/tos-version-contract.spec.ts`.

- [ ] Write contract spec (model on `src/zones/floor-price-contract.spec.ts`): imports `TOS_VERSION` from `@hyrox-sponsor/shared/tos-version` and `CURRENT_TOS_VERSION` from `./tos-version`; `describe('tos version contract')` -> `describe('when compared with the shared web constant')` -> `it('is the same version')`.
- [ ] Run; confirm fail.
- [ ] Create `src/common/tos-version.ts`: `export type TosVersion = Brand<string, 'TosVersion'>;` and `export const CURRENT_TOS_VERSION = '2026-10-10-draft' as TosVersion;` (cast is allowed here: `src/common` validating-constant file). Follow the import style of `src/common/ids.ts` for `Brand`.
- [ ] Run; confirm pass. Commit `feat(auth): add backend tos version constant with contract spec`.

## Task 3: Prisma schema and migration

Files: modify `prisma/schema.prisma`; create `prisma/migrations/20261010090000_add_athlete_tos_acceptance/migration.sql`.

- [ ] Add to `Athlete`, right after `adultAttestedAt`, aligned like neighbours: `tosAcceptedAt DateTime? @map("tos_accepted_at") @db.Timestamptz(3)` and `tosVersion String? @map("tos_version")`.
- [ ] Generate SQL with `npx prisma migrate dev --create-only --name add_athlete_tos_acceptance` (local DB, port 5435; `docker compose up -d` if down). Ensure the folder timestamp sorts after `20261009100000_add_staff_members`; rename the folder if the generated one does not.
- [ ] Append to the migration the CHECK, with a one-line SQL comment that Prisma cannot express it: `ALTER TABLE "athletes" ADD CONSTRAINT "athletes_tos_acceptance_consistent" CHECK ((tos_accepted_at IS NULL) = (tos_version IS NULL));` (match the formatting in `20261002085306_add_athlete_auth/migration.sql`).
- [ ] Apply: `npx prisma migrate dev`; then `npx prisma generate`. Confirm in psql or `prisma studio` that existing rows are null and that inserting only one of the two columns is rejected.
- [ ] `git status`: only schema + the new migration folder changed. Commit `feat(athletes): add tos acceptance columns`.

## Task 4: AthleteService gate and AthleteDb persistence

Files: modify `src/athletes/athlete.service.ts`, `src/athletes/athlete.db.ts`, `src/athletes/athlete.service.spec.ts`.

Update existing tests first: in `athlete.service.spec.ts`, the `register` suite `input` fixture gains `tosVersion: CURRENT_TOS_VERSION` so existing attestation tests keep isolating the adult gate; the `db.create` expectation (line ~148) now also expects `tosAcceptedAt: now` and `tosVersion: CURRENT_TOS_VERSION`.

New failing tests (nested describes):

- [ ] `describe('assertTosAccepted')`:
  - `when tosVersion is undefined`: `it` rejects with `tos_acceptance_required`; throws `BadRequestException`; warn-logs (follow how existing logger assertions are done, if any).
  - `when tosVersion is not the current version`: rejects with `tos_version_mismatch`; throws `BadRequestException`.
  - `when tosVersion is the current version`: does not throw and returns `CURRENT_TOS_VERSION`.
- [ ] `describe('register')` additions:
  - `when tosVersion is missing`: rejects `tos_acceptance_required`; `db.create` not called.
  - `when tosVersion is stale`: rejects `tos_version_mismatch`; `db.create` not called.
  - `when both attestation and tosVersion are missing`: rejects with `adult_attestation_required` (adult gate first).
  - `when attested and ToS accepted`: `db.create` called with `tosAcceptedAt` equal to `adultAttestedAt` (same `now` under fake timers) and `tosVersion` equal to the current version.
- [ ] Run `npx vitest run src/athletes`; confirm failures are the expected ones.
- [ ] Implement per spec 4.2: `assertTosAccepted(tosVersion: string | undefined): TosVersion`; `register` input gains `tosVersion: string | undefined`, calls both asserts, single `const now = new Date()`; warn logs carry readable detail (received vs current), thrown messages are only the snake_case codes. `AthleteDb.create` data type gains `tosAcceptedAt: Date; tosVersion: TosVersion` (no other db change; it stays the only ORM-importing file).
- [ ] Run `npx vitest run src/athletes`, `npm run lint:arch`; confirm pass. Commit `feat(athletes): gate signup on tos acceptance and persist version`.

## Task 5: Signup DTO and AuthService threading

Files: modify `src/auth/dto/signup.dto.ts`, `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`, `src/common/validation-pipe.spec.ts`.

Update existing tests first:

- [ ] `auth.service.spec.ts`: the signup `input` (line ~75) gains `tosVersion: CURRENT_TOS_VERSION`; the `athleteService.register` expectation (line ~123) also expects `tosVersion`. Add `athleteService.assertTosAccepted` mock usage consistent with how `assertAdultAttested` is mocked (it is a DeepMock; give it a `mockReturnValue(CURRENT_TOS_VERSION)` in the default `beforeEach` if `signup` code uses the return).
- [ ] `validation-pipe.spec.ts`: `valid` payload gains `tosVersion: '2026-10-10-draft'`.

New failing tests:

- [ ] `AuthService.signup`: `when tos acceptance is rejected` -> propagates `tos_acceptance_required` (mock `assertTosAccepted` to throw), does not hash the password, does not call `register`. `when both gates would fail`: `adult_attestation_required` thrown (adult checked first). `when accepted`: `register` called with `tosVersion`.
- [ ] `validation-pipe.spec.ts` (SignupDto): `when tosVersion is a number` -> `validation_failed`; `when tosVersion is empty string or over 64 chars` -> `validation_failed`; `when tosVersion is omitted` -> passes the pipe (service owns the domain error).
- [ ] Run; confirm failures. Implement per spec 4.2: DTO field `@IsOptional() @IsString() @Length(1, 64) tosVersion?: string;`; `AuthService.signup` input gains `tosVersion?: string`, calls `assertAdultAttested` then `assertTosAccepted` before `hasher.hash`, forwards `tosVersion` to `register`.
- [ ] Run `npx vitest run` (full backend), `npm run lint`, `npm run lint:arch`. Commit `feat(auth): require tos version on signup`.

## Task 6: Web validation and error messages

Files: modify `web/src/lib/auth/validation.ts`, `validation.spec.ts`, `auth-errors.ts`, `auth-errors.spec.ts`, `auth-types.ts`.

- [ ] Update `validation.spec.ts` `VALID_SIGNUP` with `tosAccepted: true`; add `describe('ToS acceptance')` -> `when unchecked` -> result has property `tosAccepted` with message `You must agree to the Terms of Service.`; `when checked` -> no `tosAccepted` key.
- [ ] `auth-errors.spec.ts`: add table rows `tos_acceptance_required` -> `You must agree to the Terms of Service.` and `tos_version_mismatch` -> `The Terms of Service were updated. Reload the page and agree again.`
- [ ] Run `npm test -w web -- validation auth-errors`; confirm fail. Implement: `SignupFormInput.tosAccepted: boolean`; extra `collect` entry; two `MESSAGES` entries; `SignupInput.tosVersion: string` in `auth-types.ts` (spec 4.4).
- [ ] Run; confirm pass. Do not commit yet if later type checks break; commit once Task 8 compiles, or commit `feat(web): validate tos acceptance on signup` here if `npm run check -w web` passes (it will not until Task 8/9 fixtures are updated; prefer one commit after Task 9).

## Task 7: Draft copy source

Files: create `web/src/lib/legal/terms.ts`, `web/src/lib/legal/terms.spec.ts`.

- [ ] Write `terms.spec.ts` first: `describe('TOS_SECTIONS')`: `when listed` -> ids are unique; every heading non-empty; every section has at least one non-empty paragraph; ids include all of `eligibility`, `trademark`, `auctions`, `bids`, `payments`, `obligations`, `disputes`, `liability` (spec 4.5). `describe('TOS_DRAFT_NOTICE')`: `when set` -> contains `DRAFT` and `not legal advice`.
- [ ] Run; fail. Create `terms.ts` exporting `TOS_TITLE`, `TOS_SECTIONS` (`{ id; heading; paragraphs }[]`), `TOS_DRAFT_NOTICE: string | null = 'DRAFT - not legal advice. Placeholder terms pending review.'`. Use a `TosSection` interface exported from the same file. Copy content, plain-language placeholders (write each as 1-3 short paragraphs; do not invent numeric fees or refund windows, say "as shown at checkout"):
  - about: Marketplace connecting athletes who offer body-zone sponsorship space with sponsors who bid for it; using the site or creating an account means agreeing.
  - eligibility: Must be 18 or older; creating an account is an attestation of this; accounts of minors may be removed.
  - accounts: Accurate information, keep credentials secret, one person per account, responsible for activity.
  - trademark: Platform is independent; not affiliated with, endorsed or sponsored by HYROX or its organisers; HYROX is a trademark of its owner; used only to identify events.
  - auctions: Athletes list body zones (e.g. chest, forearm) for a race with a floor price; sponsors bid in a time-limited auction; highest valid bid at close wins; a sale only means the right to display the sponsor during the stated race, subject to event rules.
  - bids: A bid is a binding offer; cannot be withdrawn once placed except as the platform allows; winning bidder must pay.
  - payments: Payments are processed through a third-party processor and held in escrow until proof of sponsorship is accepted; refunds as described at checkout and where sponsorship is not delivered; processor fees and taxes may apply.
  - obligations: Athletes must display the sponsor as agreed and submit proof; sponsors must supply lawful content; platform may reject proof, strike or ban for breaches.
  - disputes: Raise disputes through the platform within the stated period; the platform may review proof and decide the escrow outcome; governing law and venue are to be set.
  - liability: Service provided as is; no liability for race outcomes, injury, event rule decisions by organisers, or indirect losses, to the extent permitted by law; nothing excludes liability that cannot be excluded.
  - changes: Terms may change; the version in force is shown on this page; continued use after notice means acceptance.
  - contact: A contact address placeholder, `[contact email to be set]`.
- [ ] Run; pass. Commit with Task 9 or alone: `feat(web): add draft terms of service copy`.

## Task 8: /terms page

Files: create `web/src/routes/terms/+page.svelte`, `web/src/routes/terms/page.spec.ts` (match where existing route-level specs live; if none exist, colocate as `web/src/routes/terms/terms-page.spec.ts` since vitest includes `src/**/*.spec.ts`).

- [ ] Write the failing test with `@testing-library/svelte`: `describe('terms page')`:
  - `when rendered`: h1 `Terms of Service`; an `h2` for every `TOS_SECTIONS` heading; shows the text of `TOS_VERSION`; link to `/signup`.
  - `when the draft notice is set`: banner with `DRAFT - not legal advice` visible. (Use `vi.mock('$lib...')` or relative-path `vi.doMock` of `terms.ts` to set `TOS_DRAFT_NOTICE` to null for the next case.)
  - `when the draft notice is null`: no banner.
- [ ] Run; fail. Implement per spec 4.4: `<svelte:head><title>`, `<main class="mx-auto flex max-w-2xl flex-col gap-6 p-6">`, banner `role="note"`, sections with `aria-labelledby`, import `TOS_VERSION` from `@hyrox-sponsor/shared/tos-version` (check how existing web code imports shared, e.g. `body-map`, and match). Relative imports with `.ts` extension, as in existing pages.
- [ ] Run; pass. Confirm `/terms` is reachable unauthenticated with `npm run dev -w web` (curl or browser; no auth gate exists).
- [ ] Commit `feat(web): add public terms of service page` (include Task 7 files if not yet committed).

## Task 9: SignupForm checkbox and plumbing

Files: modify `web/src/lib/auth/SignupForm.svelte`, `SignupForm.spec.ts`, `web/src/lib/server/session-handlers.ts`, plus fixtures in `session-handlers.spec.ts`, `backend-auth.spec.ts`, `auth-api.spec.ts`, `session.spec.ts`.

Update existing tests first (they will fail typecheck/assertions until the type change lands):

- [ ] `SignupForm.spec.ts`: `fill(confirm, attest)` gains a `tos` boolean (default true) that clicks `getByLabelText('I agree to the Terms of Service')`; success expectation includes `tosVersion: TOS_VERSION`.
- [ ] `session-handlers.spec.ts` (lines ~105, 116, 131, 246), `backend-auth.spec.ts` (~79, 131), `auth-api.spec.ts` (~63), `session.spec.ts` (~267): add `tosVersion: '2026-10-10-draft'` to every signup payload fixture (use the `TOS_VERSION` import where it reads naturally).

New failing tests:

- [ ] `SignupForm.spec.ts`: `when the ToS box is unchecked` -> field error `You must agree to the Terms of Service.` shown, `session.signup` not called. `when the link is rendered` -> `getByRole('link', { name: 'Terms of Service' })` has `href` `/terms`, `target` `_blank`, `rel` containing `noopener`. `when the link is clicked` -> checkbox stays unchecked (use `preventDefault` on the click event in the test to avoid jsdom navigation noise). `when the server rejects with tos_version_mismatch` -> shows the mapped message.
- [ ] `session-handlers.spec.ts` signup: `when tosVersion is missing` -> 400 `validation_failed`, backend not called; `when tosVersion is not a string` -> same; `when valid` -> backend receives `tosVersion`.
- [ ] Run `npm test -w web`; confirm failures. Implement: form state `tosAccepted`; validate with `tosAccepted`; send `tosVersion: TOS_VERSION`; second checkbox block cloned from the adult block with ids `signup-tos-error` and aria wiring; label "I agree to the " + link (spec 4.4). `parseSignup` requires `typeof body.tosVersion === 'string'` and returns it.
- [ ] Run `npm test -w web`, `npm run check -w web`, `npm run lint`. Commit `feat(web): require tos acceptance on signup`.

## Task 10: Final verification

- [ ] `npm test` (root vitest; confirm it also covers `shared` and `web` as before, else run each workspace), `npm run lint`, `npm run lint:arch`, `npm run check -w web`, `npm run build`.
- [ ] Manual smoke against local stack: signup without ToS box blocked client-side; `curl` `/auth/signup` without `tosVersion` -> 400 `tos_acceptance_required`; with `tosVersion: "old"` -> 400 `tos_version_mismatch`; valid -> 201 and row has `tos_accepted_at` + `tos_version` populated and equal timestamps to `adult_attested_at`.
- [ ] `git status`: stage everything (no stray files), do not commit anything left over, tell the user it is staged and ready for `/crit`.

---

Self-review notes: spec coverage - page (T7, T8), checkbox (T9), persistence + migration (T3, T4), gate + codes (T4, T5), shared sync (T1, T2), draft marker (T7, T8), existing-test updates (T4, T5, T6, T9). Rollout order: backend first, web right after (spec section 7).
