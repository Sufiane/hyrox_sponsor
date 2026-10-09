# Hyrox Sponsor — Backend

NestJS + Prisma + PostgreSQL. See `docs/specs/2026-09-28-core-data-model-design.md`
for the data model design.

## Local development

1. Copy `.env.example` to `.env`.
2. `docker compose up -d postgres minio`
3. `npm install`
4. `npx prisma migrate deploy`
5. `npm run build && npm run lint && npm run lint:arch && npm test`

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

Access token 15 min, refresh token 7 days. Staff-only controllers live under `/admin/*`, use `@UseGuards(StaffGuard)` and receive the reviewer via `@CurrentStaffId()`. Athlete and staff tokens are not interchangeable.

Env (required, validated at boot): `STAFF_JWT_SECRET` (min 32 chars, must differ from `JWT_SECRET`), `STAFF_JWT_TTL_SECONDS` (default 900), `STAFF_REFRESH_TOKEN_TTL_SECONDS` (default 604800). Existing local `.env` files need the new variables.

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
- Staff review API and staff auth are HYR-29. `RaceEntryService.listAwaitingReview`, `getDocumentAccess` (300 second signed URL) and `reviewVerification` exist for it.

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
