# HYR-42 Integration tests in CI Implementation Plan

Spec: `docs/specs/2026-10-31-hyr-42-integration-tests-ci-design.md`

**Goal:** CI runs `npm run test:integration` against a Postgres service; the suite fails in CI when Postgres is unreachable and still skips locally.

**Size:** ~95 lines, single PR, one layer (test infra + CI). No ticket split. Not backend/frontend work in the app sense; no web work. Tasks are sequential (small).

**Conventions:** conventional commits (lowercase imperative), exact version pins, explicit return types, no single-letter names, no inline `if`, blank line before `if/return/throw`, `describe('when ...')` nesting, no barrel files, no comments unless non-obvious why. Stage and stop for `/crit` before committing implementation. Branch `hyr-42`; move Linear ticket to In Progress first.

## Task 1: Fail-in-CI gate in the helper (TDD)

Files: modify `src/testing/throwaway-database.ts`; create `src/testing/throwaway-database.spec.ts` (picked up by `npm test`, pure, no DB).

- [ ] Write failing spec for a pure function `requireReachableInCi(reachable: boolean, env: NodeJS.ProcessEnv): boolean`:
  - `describe('when postgres is reachable')`: returns `true` for `CI` unset and `CI='true'`.
  - `describe('when postgres is unreachable')` with nested `describe('and CI is true')` -> throws `postgres_unreachable`; `describe('and CI is "1"')` -> throws; `describe('and CI is unset')` -> returns `false`; `describe('and CI is "false" or empty')` -> returns `false`.
- [ ] Run `npx vitest run src/testing/throwaway-database.spec.ts`; expect FAIL (export missing).
- [ ] Implement `isCi(env)` (true for `'true'` or `'1'`) and `requireReachableInCi` in `throwaway-database.ts`. Throws `new Error('postgres_unreachable')`, no logging, explicit return types.
- [ ] Re-run; expect PASS.
- [ ] Stage (`git add`), no commit yet.

## Task 2: Use the gate in the int spec

Files: modify `src/bids/usecases/place-bid/place-bid.usecase.int.spec.ts` (~3 lines).

- [ ] Import `requireReachableInCi`; change to `const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);`. Keep `describe.skipIf(!reachable)`.
- [ ] Verify locally with Postgres up (`docker compose up -d postgres`): `npm run test:integration` passes.
- [ ] Verify skip: `TEST_ADMIN_DATABASE_URL=postgresql://hyrox:hyrox@localhost:1/postgres npm run test:integration` -> skipped, exit 0.
- [ ] Verify fail: same command with `CI=true` -> file fails with `postgres_unreachable`, non-zero exit.
- [ ] Run `npm run verify:fast` (lint, lint:arch, typecheck, tests) green.
- [ ] Stage.

## Task 3: CI job

Files: modify `.github/workflows/ci.yml`.

- [ ] Re-verify action SHAs with `git ls-remote --tags https://github.com/actions/checkout` and `.../actions/setup-node`; reuse the existing pinned SHAs (v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`) with the trailing version comments.
- [ ] Look up the latest `postgres:16.x` tag on Docker Hub; use the exact tag.
- [ ] Add job `integration` (sibling of `verify`): `runs-on: ubuntu-24.04`, `timeout-minutes: 15`, `env.TEST_ADMIN_DATABASE_URL: postgresql://hyrox:hyrox@localhost:5432/postgres`, `services.postgres` (image exact tag, env `POSTGRES_USER=hyrox`, `POSTGRES_PASSWORD=hyrox`, `POSTGRES_DB=postgres`, ports `5432:5432`, `options: --health-cmd "pg_isready -U hyrox" --health-interval 5s --health-timeout 5s --health-retries 10`).
- [ ] Steps: checkout, setup-node (24, cache npm), `npm ci`, `Generate prisma client` (`npx prisma generate`), `Run integration tests` (`npm run test:integration`).
- [ ] Validate YAML (`npx --yes` is not allowed to add deps; use `python3 -I -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'))"` or `actionlint` if installed).
- [ ] Stage.

## Task 4: Align compose and docs

Files: modify `docker-compose.yml` (image to the same exact tag), `README.md` (short `test:integration` note: needs Postgres on 5435 via compose, `TEST_ADMIN_DATABASE_URL`, skips locally when unreachable, fails when `CI` is set).
- [ ] Apply edits; stage.

## Task 5: Prove it in CI and hand off

- [ ] Push branch `hyr-42`, open PR (conventional title `ci: run integration tests with a postgres service`), confirm `integration` job green and test count is non-zero (not "skipped").
- [ ] Negative proof (temporary, not committed): on a scratch push change the service port or URL so Postgres is unreachable; confirm the job goes red with `postgres_unreachable`. Revert.
- [ ] Re-run the job 3 times to check for flakiness.
- [ ] PR body: note that the `integration` check should be added as required in branch protection (manual).
- [ ] Suggested commits: `test: fail integration suite in ci when postgres is unreachable` (tasks 1-2), `ci: add integration test job with postgres service` (task 3), `docs: document integration test setup` (task 4, can fold into 3).
