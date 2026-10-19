# Hyrox Sponsor — Backend

NestJS + Prisma + PostgreSQL. See `docs/specs/2026-09-28-core-data-model-design.md`
for the data model design.

## Local development

1. Copy `.env.example` to `.env`.
2. `docker compose up -d postgres minio`
3. `npm install`
4. `npx prisma migrate deploy`
5. `npm run verify`

## Verification and git hooks

| Command | Runs |
|---|---|
| `npm run verify` | lint, lint:arch, typecheck, test, build (fail-fast) |
| `npm run verify:fast` | same without build |
| `npm run typecheck` | `tsc` on `tsconfig.build.json` (plain `tsconfig.json` has unrelated errors under `web/` and `shared/`). Excludes `*.spec.ts` and `web/`, so type errors there are not caught. |

A pre-push hook runs `verify:fast` (no build). It is tracked in `.githooks/` and installed by the root `prepare` script (`git config core.hooksPath .githooks`) on `npm install` / `npm ci`. The setting is shared across worktrees and overwrites a custom `core.hooksPath`. Reinstall with `npm run prepare`.

Bypass: `git push --no-verify`.

## CI (HYR-37)

`.github/workflows/ci.yml` runs one `verify` job on every pull request and on pushes to `main`. No database is needed (tests do not hit Postgres). Steps, in order:

```bash
npm ci
npx prisma generate
npm run verify
npm run check -w shared
npm run check -w web
npm test -w shared
npm test -w web
```

Run the same commands locally to reproduce a CI failure. Mark `verify` as a required status check in branch protection for `main`.

## Auth

Athlete email + password (argon2id), short-lived access JWT, rotating hashed refresh token. Spec: `docs/specs/2026-10-01-athlete-auth-design.md`.

| Route | Auth | Success |
|---|---|---|
| `POST /auth/signup` | none | 201 `{ athlete, accessToken, refreshToken, expiresIn }` (requires `adultAttested: true`) |
| `POST /auth/login` | none | 200 same shape |
| `POST /auth/refresh` | refresh token in body | 200 `{ accessToken, refreshToken, expiresIn }` (rotates) |
| `POST /auth/logout` | refresh token in body | 204 |
| `GET /auth/me` | `Authorization: Bearer <access jwt>` | 200 `{ id, name, email, isAdult }` |

Env: `JWT_SECRET` (min 32 chars, the app refuses to boot otherwise), `JWT_ACCESS_TTL_SECONDS` (default 900), `REFRESH_TOKEN_TTL_SECONDS` (default 2592000), `CORS_ORIGINS` (comma-separated allowlist, default none), `DATABASE_URL` (required, postgres URL), `PORT` (default 3000), `TRUST_PROXY_HOPS` (integer 0 to 10, default 0; number of proxies between the client IP the BFF resolved and Nest, counting the BFF itself; never `true`). All validated at boot.

Known tradeoffs: no email verification; `400 email_already_registered` reveals registered emails; `trust proxy` stays off until `TRUST_PROXY_HOPS` is set, so behind a proxy the throttler keys on the proxy IP (see production notes under Web auth).

## Staff accounts (HYR-29)

Staff are a separate identity (`staff_members`, `staff_refresh_tokens`) with their own JWT secret. Accounts are managed by CLI only; there is no signup endpoint. Spec: `docs/specs/2026-10-09-staff-auth-design.md`.

```
npm run build
npm run staff -- create --email jane@example.com --name "Jane Doe" [--password "<pw>"]
npm run staff -- set-password --email jane@example.com [--password "<pw>"]
npm run staff -- deactivate --email jane@example.com
```

- `--password` is optional (10-128 characters, same rule as athlete signup). When omitted, a random password is generated and printed once; only its argon2id hash is stored.
- A password passed with `--password` stays in shell history and the process list. Accepted for local use; omit the flag on shared or production hosts.
- `set-password` and `deactivate` revoke every refresh token of that staff member and invalidate their existing access tokens.

| Route | Auth | Success |
|---|---|---|
| `POST /staff/auth/login` | none (5/min/IP) | 200 `{ staff, accessToken, refreshToken, expiresIn }` |
| `POST /staff/auth/refresh` | refresh token in body (10/min/IP) | 200 `{ accessToken, refreshToken, expiresIn }` (rotates, reuse revokes all) |
| `POST /staff/auth/logout` | refresh token in body | 204 |
| `GET /staff/auth/me` | `Authorization: Bearer <staff access jwt>` | 200 `{ id, name, email }` |

Access token 15 min, refresh token 7 days. Staff-only controllers live under `/staff/*`, use `@UseGuards(StaffGuard)` and receive the reviewer via `@CurrentStaffId()`. Athlete and staff tokens are not interchangeable.

Env (required, validated at boot): `STAFF_JWT_SECRET` (min 32 chars, must differ from `JWT_SECRET`), `STAFF_JWT_TTL_SECONDS` (default 900), `STAFF_REFRESH_TOKEN_TTL_SECONDS` (default 604800). Existing local `.env` files need the new variables.

### Bib review API (HYR-33)

All routes need `Authorization: Bearer <staff access jwt>` (missing, invalid or athlete token gives 401 `invalid_token`). Spec: `docs/specs/2026-10-10-bib-review-api-design.md`.

| Route | Body | Success |
|---|---|---|
| `GET /staff/race-entries/awaiting-review` | none | 200 `AwaitingReviewItem[]` (PENDING, oldest first, max 50) |
| `GET /staff/race-entries/:raceEntryId/verification-document-url` | none | 200 `{ url, expiresAt, documentKey }` (300 second signed URL, `Cache-Control: no-store`) |
| `POST /staff/race-entries/:raceEntryId/verification/approve` | `{ reviewedDocumentKey }` | 204 |
| `POST /staff/race-entries/:raceEntryId/verification/reject` | `{ reviewedDocumentKey, reason }` (reason 1 to 500 chars, trimmed) | 204 |

`reviewedDocumentKey` is the `documentKey` the reviewer saw; a changed document gives 409. The reviewing staff id comes from the token and is stored in `verified_by`.

Errors: 400 `validation_failed`, `document_key_invalid`, `rejection_reason_required`; 404 `race_entry_not_found`, `verification_document_not_found`; 409 `verification_not_pending`, `verification_document_changed`.

## Hand-written SQL and `prisma migrate dev`

The migrations hand-write objects Prisma cannot express in `schema.prisma`: the
`floor_price_cents >= 1000` CHECK constraint, the partial unique index
`bid_one_leading_per_auction`, and the `athletes_adult_attestation_consistent` CHECK. `prisma migrate dev` may propose dropping them.
Review generated SQL and remove any such `DROP` statements.

Sanity check before committing schema changes (uses a scratch shadow database, never the dev DB):

```sh
docker compose exec postgres psql -U hyrox -d postgres -c "CREATE DATABASE shadow_check"
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://hyrox:hyrox@localhost:5435/shadow_check?schema=public" --script
docker compose exec postgres psql -U hyrox -d postgres -c "DROP DATABASE shadow_check"
```

Expected output: `-- This is an empty migration.` Observed on the current schema: no
`DROP INDEX` for `bid_one_leading_per_auction` and no CHECK removal. Any `DROP` in the output
is a regression to investigate.

## API

- `POST /athletes/:athleteId/race-entries` logs a race. Body: `name`, `date` (ISO datetime with offset), `timezone` (IANA), `location`, `division` (`SINGLE_OPEN_MEN`, ... see `src/races/race-division.ts`). Creates or reuses the `Race` (matched on normalized name, start instant, timezone) and a `PENDING` entry; returns 201. Errors: 400 (`validation_failed` for any body field, `iana_timezone_invalid`, `athlete_id_invalid`), 403 `athlete_banned`, 404 `athlete_not_found`, 409 `race_entry_date_conflict`. The athlete id in the path is a stand-in until auth (HYR-3) supplies it.

## Verification documents

Athletes upload a bib or confirmation document (JPEG, PNG, WebP or PDF, up to 10 MiB) for a race entry. Objects go to a private S3-compatible bucket; only the object key is stored on `RaceEntry`.

- Env vars: `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, and `STORAGE_ENDPOINT` (set for MinIO, omit for AWS S3). See `.env.example`.
- Local dev: create the bucket `hyrox-verification-docs` once in the MinIO console at http://localhost:9006 (login `hyrox` / `hyrox-secret`).
- Endpoints (both need a HYR-3 bearer token and own the entry):
  - `POST /race-entries/:raceEntryId/verification-document` multipart with `document` (file) and `bibNumber` (1 to 20 chars); 201 `{ raceEntryId, verificationStatus: 'PENDING', submittedAt }`. Errors: 400 `document_missing`, `document_too_large`, `document_type_unsupported`, `validation_failed`; 401 `invalid_token`; 403 `athlete_banned`; 404 `race_entry_not_found`; 409 `race_entry_already_verified`, `race_already_started`, `verification_state_changed`.
  - `GET /race-entries/:raceEntryId/verification` returns the status view (never the document key).
- Migrations: the HYR-6 migration hand-writes one rename (`verification_document_url` to `verification_document_key`); run the shadow-database check above and expect an empty migration.
- HYR-8 gate contract: call `RaceEntryService.assertVerified(raceEntryId)` (throws 404 `race_entry_not_found` / 409 `race_entry_not_verified`) or `isVerifiedById` before creating or opening an auction. There is no DB trigger, so HYR-8's due-auctions query MUST filter `verificationStatus: 'VERIFIED'`.
- Staff review API is HYR-33 (see below); staff auth is HYR-29.

## Race results (HYR-21)

Athletes self-report a finish time with a clock photo and an optional proof link; staff review each result; the public sees PENDING and VERIFIED results of verified-bib entries, ranking VERIFIED times only. Spec: `docs/specs/2026-10-10-public-race-results-design.md`.

| Route | Auth | Notes |
|---|---|---|
| `PUT /race-entries/:raceEntryId/result` | athlete | multipart `photo`, `finishTimeSeconds` (1800-21600), `proofUrl?`; 10/min; any edit resets to PENDING; omitting `photo` on edit keeps the old one |
| `GET /race-entries/:raceEntryId/result` | athlete | own result, `publicVisible`, rejection reason |
| `GET /race-entries` | athlete | own entries (cap 50) with bib and result status |
| `GET /staff/race-results` | staff | PENDING queue, oldest first, cap 50 |
| `GET /staff/race-results/:raceResultId` | staff | detail with 5-minute signed photo URL, `no-store` |
| `POST /staff/race-results/:raceResultId/approve` | staff | body `{ submittedAt }`, 204 |
| `POST /staff/race-results/:raceResultId/reject` | staff | body `{ submittedAt, reason }`, 204 |
| `GET /public/races` | none | `limit`, `cursor`; races with a public result |
| `GET /public/races/:raceId` | none | divisions with counts |
| `GET /public/races/:raceId/results` | none | `division` required, `limit` (max 100), `offset` (max 10000) |

Public routes send `Cache-Control: public, max-age=60` and never expose photo, proof link, ids, email or bib. Error codes: `race_entry_not_found`, `athlete_banned`, `race_not_finished`, `proof_photo_missing`, `proof_photo_too_large`, `proof_photo_type_unsupported`, `finish_time_out_of_range`, `seconds_invalid`, `proof_url_invalid`, `proof_url_host_not_allowed`, `result_state_changed`, `race_result_not_found`, `result_not_pending`, `result_changed`, `rejection_reason_required`, `race_not_found`, `cursor_invalid`.

Env: `RESULT_PROOF_URL_HOSTS` (comma-separated exact hosts allowed in proof links, default empty meaning every link is refused; fill before launch).

## Auction scheduling (HYR-8)

An in-process job (`AuctionSchedulerTask`, every 60 s) drives the auction lifecycle: it creates the nine `SCHEDULED` zone auctions for each `VERIFIED` race entry, opens them at race-local midnight of day -12, and closes them at race-local midnight of day -5. Closing marks the leading bid `WON` (others `LOST`, `outcome AWAITING_PROOF`, `proofDeadlineAt` = race start + 48 h) or sets `outcome NO_SALE` when there is no leading bid. All writes are idempotent compare-and-set, so several instances can tick at once.

- Set `AUCTION_SCHEDULER_ENABLED=false` on replicas or local workspaces that should not tick (default `true`). If it is disabled everywhere, auctions silently stall; each tick that changes something logs its counts.
- Spec: `docs/specs/2026-10-09-auction-scheduling-design.md`.

## Branded types

Domain scalars (entity ids, `NormalizedEmail`, `Cents`, Stripe ids, `TrustScore`, `IanaTimezone`) are branded types living in `src/common`, which never imports `@prisma/client`. Validating constructors (`cents()`, `trustScore()`, `ianaTimezone()`, `normalizeEmail()`) build them. Only `*.db.ts` files and these constructors cast to a brand; services never do.

## Conventions

- **Error codes and logging**: services throw snake_case codes (`NotFoundException('athlete_not_found')`) and log the readable detail with a per-service `Logger` at the throw site (`warn` for not-found, with ids). `src/common` helpers throw `Error` with only a code (`cents_invalid`, ...) and never log; callers log.
- **No barrel files**: import the specific file without an extension (`../common/ids`). `tsc-alias --resolve-full-paths` adds `.js` in `dist` at build time (`moduleResolution: Bundler`).
- **Tests**: service specs use `Test.createTestingModule` with `mockDeep<XDb>()` from `vitest-mock-extended` as the db provider; decorator metadata comes from `emitDecoratorMetadata` in `tsconfig.json` (Vitest 5 on Vite 8 emits it natively, no swc plugin). Helper specs in `src/common` are plain.
- TypeScript targets ES2025.

## Web auth (HYR-30)

The web app keeps the access token in memory only. The refresh token lives in an httpOnly, SameSite=Strict cookie (`hyrox_refresh`, path `/session`) owned by SvelteKit routes that proxy the Nest `/auth/*` endpoints: `POST /session/login`, `/session/signup`, `/session/refresh`, `/session/logout`. The refresh token never appears in a JSON response to the browser. Because these routes need a runtime, the web deploy adapter must be a server adapter, not static.

- `web/src/lib/auth/session.svelte.ts` is the session store (bootstrap on load, single-flight refresh, `navigator.locks` across tabs).
- `web/src/lib/auth/authed-fetch.ts` wraps `fetch` with the bearer token, a proactive refresh 30 s before expiry and one retry on 401. Use it for every API call.
- The BFF reads the backend URL from `VITE_API_BASE_URL` and uses a fixed 30-day cookie lifetime matching the backend default.
- Auth throttle (HYR-31): the BFF overwrites `X-Forwarded-For` with SvelteKit's `getClientAddress()` on every `/session/*` call, and Nest trusts `TRUST_PROXY_HOPS` hops so the 10/min throttle on `/auth/login|signup|refresh` is per client IP. Production notes (for HYR-32):
  - With hops >= 1, do not expose `/auth/*` publicly on the API ingress; a direct caller could spoof `X-Forwarded-For` and bypass the limit.
  - Hop count must match the real topology (BFF straight to Nest = 1); re-verify after infra changes.
  - On adapter-node, set `ADDRESS_HEADER` and `XFF_DEPTH` for the web ingress, or `getClientAddress()` returns the ingress IP.
  - The throttler store is in-memory per API instance, so N replicas allow up to N times the limit.

## Workspaces and body map (HYR-7)

The repo is an npm workspace: the backend stays at the root, with two packages beside it.

- `shared/` (`@hyrox-sponsor/shared`): framework-free zone model. `body-zone.ts` (`BODY_ZONES`, `BodyZone`), `body-zone-labels.ts`, `body-map-geometry.ts` (views, silhouette and region paths, `regionsForZone`). Import from the specific file, e.g. `@hyrox-sponsor/shared/body-zone`.
- `web/`: SvelteKit + Tailwind + Vitest. Run `npm run -w web dev`, then open `/dev/body-map` for the harness. Checks: `npm run -w web check`, `npm run -w web test`, `npm run -w web build`. Shared: `npm run -w shared test`.

`web/src/lib/body-map/BodyMap.svelte` API (consumed by HYR-27):

- `selected: BodyZone | null` (bindable), single selection; re-clicking keeps it selected.
- `zoneStates?: Partial<Record<BodyZone, { badge?: string; disabled?: boolean }>>`
- `disabled?: boolean` for the whole map.
- `onselect(zone: BodyZone)` callback.

`LEFT_*` is the athlete's own left (viewer's right on the front view). The artwork is a placeholder: replace the path strings in `shared/src/body-map-geometry.ts` to swap it.
