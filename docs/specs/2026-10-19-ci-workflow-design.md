# CI workflow (HYR-37) Design

## Goal
Run lint, architecture check, typecheck and tests on every PR and every push to `main`, so a red check blocks broken merges. No CI exists today (no `.github/`).

## Current state (verified locally, Node 24.21, clean tree)
| Command | Result |
|---|---|
| `npm run lint` | passes (~4s) |
| `npm run lint:arch` | passes, 0 violations (278 modules) |
| `npm run build` (root `tsc -p tsconfig.build.json`, excludes specs) | passes |
| `npm run check -w shared` (`tsc --noEmit`) | passes |
| `npm run check -w web` (`svelte-kit sync && svelte-check`) | passes, 0 errors |
| `npm test` (root, 94 files / 885 tests) | passes (~4s) |
| `npm test -w shared` | passes (50 tests) |
| `npm test -w web` | passes (358 tests) |
| `tsc --noEmit -p tsconfig.json` at root | FAILS: root tsconfig has no `include`, so it swallows `web/` and its `$types`. Not a usable typecheck |
| root tsc including `*.spec.ts` (src only) | 2 pre-existing errors in `src/auctions/auction-scheduler.task.spec.ts` (`mockReturnValue` on ConfigService) |

`web` has `"prepare": "svelte-kit sync"` (HYR-34), so `npm ci` generates `.svelte-kit` types; `check` also runs sync itself.

## Decisions
1. **One workflow, one job** (`.github/workflows/ci.yml`, job id `verify`), sequential steps. Whole run is ~1-2 min; parallel jobs would repeat `npm ci` for no gain. HYR-35's `npm run verify` (api lint, lint:arch, typecheck, test, build) is one step; shared/web checks and tests stay separate steps because verify doesn't cover them.
2. **Triggers**: `pull_request` and `push` to `main`. `concurrency` group per ref with `cancel-in-progress` for PRs. `permissions: contents: read`. `timeout-minutes: 15`.
3. **Runner/toolchain**: `ubuntu-24.04` (pinned, not `latest`), `actions/setup-node` with `node-version: 24` and `cache: npm`.
4. **Action pinning**: full commit SHAs with the version in a trailing comment:
   - `actions/checkout` v7.0.1 = `3d3c42e5aac5ba805825da76410c181273ba90b1`
   - `actions/setup-node` v7.1.0 = `949feb2413d6458794dcd2491c4babbbce0c15c1`
   Re-verify SHAs with `git ls-remote --tags` at implementation time.
5. **Install**: `npm ci` (runs web `prepare`; `@prisma/client` postinstall generates the client). An explicit `npx prisma generate` step follows `npm ci` so CI doesn't depend on the postinstall.
6. **Lint**: `npm run lint` (root script already covers `src`, `shared/src`, `web/src`).
7. **Architecture**: include `npm run lint:arch`. Fast, green, enforces the hexagonal split in CI rather than only locally.
8. **Typecheck** (three steps, no new scripts):
   - API: `npm run build` (the only working root typecheck; also proves the production build compiles). Output `dist/` is discarded.
   - `npm run check -w shared`
   - `npm run check -w web`
   Spec files are not typechecked at root (2 existing errors). Fixing them plus adding a root `typecheck` script is a follow-up ticket, not part of this PR.
9. **Tests**: `npm test`, `npm test -w shared`, `npm test -w web`. Root `npm test` does not run workspace tests (its vitest include is `src/**` only).
10. **Database: no Postgres service container.** No test instantiates `PrismaClient` or connects (only `env.validation*.ts` mention `DATABASE_URL`; all db access is mocked via `vitest-mock-extended`). Tests also run with no `.env`; the env-validation error log line in output is noise, not a failure. Same for MinIO. Revisit and add a `postgres:16` service (mirroring `docker-compose.yml`, `hyrox/hyrox/hyrox_sponsor`, with `prisma migrate deploy`) only when integration tests land.
11. **Prisma migrate**: not in CI now (needs a DB, see 10). Optional cheap addition later: `npx prisma validate`. Left out; schema errors already break `build`/tests via client generation.

## Out of scope / follow-ups
- Branch protection: mark the `verify` check required (manual repo setting).
- HYR-35 merged: CI calls `npm run verify`. Follow-up: fold shared/web checks and tests into verify.
- Typecheck specs at root (fix 2 errors + `typecheck` script).
- Deploy/CD, dependabot for action SHAs, coverage reporting.

## Risks
- `package-lock.json` is generated on macOS; `npm ci` on Linux can miss platform optional deps (argon2 prebuilds, esbuild/rollup natives). The first PR run validates this; if it fails, regenerate lock entries for linux.
- Test output shows a pre-existing env validation error line; harmless.
