# HYR-42 Integration tests in CI (Postgres service) Design

## Goal
Run `npm run test:integration` (HYR-39 concurrency tests: place-bid vs close job) on every PR and push to `main`, against a Postgres service container, and make the suite FAIL in CI when Postgres is unreachable instead of silently skipping.

## Current state (read from repo)
- `vitest.integration.config.ts`: includes `src/**/*.int.spec.ts`, `fileParallelism: false`, 60s test / 120s hook timeouts. `vitest.config.ts` excludes `*.int.spec.ts`, so `npm test` and `npm run verify` never run them.
- Only one int spec: `src/bids/usecases/place-bid/place-bid.usecase.int.spec.ts`. It does `const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL`, `const reachable = await isPostgresReachable(adminUrl)`, then `describe.skipIf(!reachable)(...)`. Unreachable Postgres = whole suite skipped, exit 0. Locally intended (HYR-39 J39-5); in CI it would be a green check that tests nothing.
- `src/testing/throwaway-database.ts`: connects with admin URL, `CREATE DATABASE hyrox_it_<12 hex>`, runs `npx prisma migrate deploy` via `execFileSync` with `DATABASE_URL` set to the new DB, builds a `PrismaService`, drops with `DROP DATABASE ... WITH (FORCE)`. Default admin URL `postgresql://hyrox:hyrox@localhost:5435/postgres` (docker-compose, port 5435).
- `.github/workflows/ci.yml`: single job `verify`, ubuntu-24.04, SHA-pinned `actions/checkout` v7.0.1 and `actions/setup-node` v7.1.0, Node 24, `npm ci`, `npx prisma generate`. No Postgres (CI-workflow design decision 10 said: add a `postgres:16` service when integration tests land, i.e. now).
- `prisma` CLI 6.19.3 is a root dependency, so `npx prisma migrate deploy` works after `npm ci` with no download.

## Decisions
1. **Separate job `integration`, not a step in `verify`.** Runs in parallel with `verify`, own red/green signal and own check name (can be made required independently), Postgres service only where needed, and a flaky concurrency test does not hide lint/unit results. Cost: one extra `npm ci` (npm cache on, ~20-30s). Same triggers, concurrency and `permissions` as the workflow; `timeout-minutes: 15`.
2. **Postgres service container**, `postgres:16.<patch>` exact tag (matches `docker-compose.yml` major; resolve latest 16.x patch at implementation time and also set it in `docker-compose.yml` so local and CI stay aligned). Env `POSTGRES_USER=hyrox`, `POSTGRES_PASSWORD=hyrox`, `POSTGRES_DB=postgres` (admin DB; tests create their own DBs). Port mapping `5432:5432`. Health check `pg_isready -U hyrox` (interval 5s, timeout 5s, retries 10) so the job waits for readiness before steps run. Throwaway credentials, CI-only, not a secret.
3. **Admin URL from env**: job-level `env: TEST_ADMIN_DATABASE_URL: postgresql://hyrox:hyrox@localhost:5432/postgres`. Reuses the variable the spec already reads; no helper or spec change for URL plumbing. The `hyrox` role is the container superuser, so `CREATE DATABASE` works.
4. **No separate `prisma migrate deploy` step.** The helper migrates each throwaway DB itself; a step against the admin DB would be wasted and migrate the wrong database. Steps: checkout, setup-node, `npm ci`, `npx prisma generate`, `npm run test:integration`.
5. **CI detection: the `CI` env var** (GitHub Actions always sets `CI=true`; the same convention is honored by most runners). A tiny pure function in `throwaway-database.ts` decides: reachable -> run; unreachable and CI -> throw `postgres_unreachable`; unreachable and not CI -> skip (laptop behaviour unchanged). Rejected alternative: a dedicated `REQUIRE_POSTGRES=1` var set in the workflow. More explicit but fails open if someone forgets it in a new workflow; `CI` fails closed by default. Trade-off accepted: a dev who exports `CI=true` locally without Postgres gets a failure, which is the desired signal.
6. **How the failure surfaces.** The spec evaluates the gate at module top level (`await`), so the throw makes vitest report the file as failed (suite failure, non-zero exit), not skipped. Error message is the snake_case code `postgres_unreachable`; the helper does not log (pure). The spec stays on `describe.skipIf(!reachable)`, which can only be false locally now.
7. **Helper works against CI Postgres without code changes**: verified by reading, to be verified by the first CI run. Points checked: URL rewrite keeps host/port/credentials; `connection_limit=20` is fine for the default `max_connections=100`; `execFileSync('npx', ...)` uses the locally installed prisma; `stdio: 'pipe'` hides migrate output on failure (see risk).
8. **Failure diagnosability (small hardening in scope).** `execFileSync` with `stdio: 'pipe'` throws an error whose message omits stderr details in some paths. In `createThrowawayDatabase`'s catch, no change; instead CI logs would show the generic error. Decision: leave as is unless the first CI run is opaque (YAGNI); note in risks.
9. **Docs**: one README line under the test commands describing `test:integration`, the `CI` fail-vs-skip rule and `TEST_ADMIN_DATABASE_URL`. Update the CI-workflow spec's decision 10 only by reference (new spec supersedes it); the old spec is not edited.

## Out of scope / follow-ups
- Marking the `integration` check required in branch protection (manual repo setting, mention in PR body).
- Running the int suite inside `npm run verify` / the pre-push hook (needs Docker locally; deliberately not forced).
- Digest-pinning the Postgres image; dependabot for the image tag and action SHAs.
- Surfacing prisma stderr in helper errors (only if the first run is opaque).

## Risks
- Concurrency tests can be timing-sensitive on a loaded shared runner (sleeps in `holdLock` style tests). First runs should be repeated 3x; if flaky, fix the test, not by retries.
- Linux `npx prisma` engines: `npm ci` plus `prisma generate` already runs on Linux in `verify`; `migrate deploy` needs the schema engine binary, downloaded at install/generate time. If the runner blocks it the first run shows it immediately.
- `CI=true` also set by some local tools; documented in README.

## Size
Workflow ~35 lines, helper function ~12, helper unit spec ~35, int-spec edit ~3, compose 1, README ~6, specs/plans docs excluded. About 95 lines of code and config. Single PR, one layer (CI/test infra), no ticket split.
