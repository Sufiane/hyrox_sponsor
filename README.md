# Hyrox Sponsor — Backend

NestJS + Prisma + PostgreSQL. See `docs/specs/2026-09-28-core-data-model-design.md`
for the data model design.

## Local development

1. Copy `.env.example` to `.env`.
2. `docker compose up -d postgres`
3. `npm install`
4. `npx prisma migrate deploy`
5. `npm run build && npm run lint && npm run lint:arch && npm test`

## Hand-written SQL and `prisma migrate dev`

The migration hand-writes objects Prisma cannot express in `schema.prisma`: the
`floor_price_cents >= 1000` CHECK constraint and the partial unique index
`bid_one_leading_per_auction`. `prisma migrate dev` may propose dropping them.
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

## Branded types

Domain scalars (entity ids, `NormalizedEmail`, `Cents`, Stripe ids, `TrustScore`, `IanaTimezone`) are branded types living in `src/common`, which never imports `@prisma/client`. Validating constructors (`cents()`, `trustScore()`, `ianaTimezone()`, `normalizeEmail()`) build them. Only `*.db.ts` files and these constructors cast to a brand; services never do.

## Conventions

- **Error codes and logging**: services throw snake_case codes (`NotFoundException('athlete_not_found')`) and log the readable detail with a per-service `Logger` at the throw site (`warn` for not-found, with ids). `src/common` helpers throw `Error` with only a code (`cents_invalid`, ...) and never log; callers log.
- **No barrel files**: import the specific file with an explicit `.js` extension (`../common/ids.js`).
- **Tests**: service specs use `Test.createTestingModule` with `mockDeep<XDb>()` from `vitest-mock-extended` as the db provider; `unplugin-swc` provides decorator metadata (swc target `es2024`). Helper specs in `src/common` are plain.
- TypeScript targets ES2025.
