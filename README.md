# Hyrox Sponsor — Backend

NestJS + Prisma + PostgreSQL. See `docs/specs/2026-09-28-core-data-model-design.md`
for the data model design.

## Local development

1. Copy `.env.example` to `.env`.
2. `docker compose up -d postgres`
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

Env: `JWT_SECRET` (min 32 chars, the app refuses to boot otherwise), `JWT_ACCESS_TTL_SECONDS` (default 900), `REFRESH_TOKEN_TTL_SECONDS` (default 2592000), `CORS_ORIGINS` (comma-separated allowlist, default none), `DATABASE_URL` (required, postgres URL), `PORT` (default 3000). All validated at boot.

Known tradeoffs: no email verification; `400 email_already_registered` reveals registered emails; `trust proxy` is not set, so behind a proxy the throttler keys on the proxy IP until it is configured at deploy time.

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

## Branded types

Domain scalars (entity ids, `NormalizedEmail`, `Cents`, Stripe ids, `TrustScore`, `IanaTimezone`) are branded types living in `src/common`, which never imports `@prisma/client`. Validating constructors (`cents()`, `trustScore()`, `ianaTimezone()`, `normalizeEmail()`) build them. Only `*.db.ts` files and these constructors cast to a brand; services never do.

## Conventions

- **Error codes and logging**: services throw snake_case codes (`NotFoundException('athlete_not_found')`) and log the readable detail with a per-service `Logger` at the throw site (`warn` for not-found, with ids). `src/common` helpers throw `Error` with only a code (`cents_invalid`, ...) and never log; callers log.
- **No barrel files**: import the specific file without an extension (`../common/ids`). `tsc-alias --resolve-full-paths` adds `.js` in `dist` at build time (`moduleResolution: Bundler`).
- **Tests**: service specs use `Test.createTestingModule` with `mockDeep<XDb>()` from `vitest-mock-extended` as the db provider; decorator metadata comes from `emitDecoratorMetadata` in `tsconfig.json` (Vitest 5 on Vite 8 emits it natively, no swc plugin). Helper specs in `src/common` are plain.
- TypeScript targets ES2025.
