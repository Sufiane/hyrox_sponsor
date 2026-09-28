# Hyrox Sponsor — Backend

NestJS + Prisma + PostgreSQL. See `docs/specs/2026-09-28-core-data-model-design.md`
for the data model design.

## Local development

1. Copy `.env.example` to `.env`.
2. `docker compose up -d postgres`
3. `npm install`
4. `npx prisma migrate deploy`
5. `npm run build && npm run lint && npm run lint:arch && npm test`
