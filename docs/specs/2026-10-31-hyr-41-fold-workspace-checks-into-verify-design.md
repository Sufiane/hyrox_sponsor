# Fold shared/web typecheck and tests into verify (HYR-41)

## Problem
`npm run verify` (HYR-35) covers the api only. Shared and web typecheck and tests run as four extra steps in `.github/workflows/ci.yml` (HYR-37), and the pre-push hook (`verify:fast`) skips them, so a web/shared break passes locally and fails only in CI. CI and local also drift: two definitions of "green".

## Scope
Tooling only: root `package.json` scripts, `ci.yml`, README. Plus (decision Q2) a spec-inclusive api typecheck. No lint rules, no new tests, no web/shared source changes, no hook file change (it keeps calling `verify:fast`).

## Measured baseline (this branch, warm cache)
| Command | Wall time |
|---|---|
| `npm run check -w shared` | ~0.4s |
| `npm test -w shared` (50 tests) | ~1.2s |
| `npm run check -w web` (svelte-kit sync + svelte-check) | ~2.8s |
| `npm test -w web` (358 tests, jsdom) | ~5s |
| Total added | ~10s |

Everything the workspaces add is cheap, so there is no reason to keep any of it out of the pre-push path.

## Design

### Scripts (root `package.json`, no dependency changes)
- `typecheck:workspaces`: `npm run check --workspaces --if-present`
- `test:workspaces`: `npm test --workspaces --if-present`
- `verify:fast`: `npm run lint && npm run lint:arch && npm run typecheck && npm run typecheck:workspaces && npm test && npm run test:workspaces`
- `verify`: `npm run verify:fast && npm run build` (unchanged)

Why `--workspaces --if-present` over explicit `-w shared -w web`: a future workspace is picked up automatically, and one without a `check`/`test` script is skipped instead of breaking verify. Cost: implicit; the README documents it. Both existing workspaces expose `check` and `test`. npm runs workspaces sequentially in the `workspaces` array order (shared, then web) and stops at first failure.

Order is cheap-and-most-likely-to-fail first (lint, arch, api typecheck), then workspace typecheck, then tests, build last. Fail-fast preserved by `&&`.

### verify:fast contents (decision Q1)
Recommend: everything in `verify` except `build`. Same rule as HYR-35 ("build excluded to keep pushes fast"), now with the workspaces included because they add ~10s. Expected pre-push total ~20s. Alternative considered: keep workspace tests out of `verify:fast` and only in `verify`. Rejected: web tests are the part most likely to break from a shared change, and the whole point of the ticket is that push-time green equals CI green.

`web` build (`vite build`) is not in verify today and stays out (CI does not run it either). Noted as a possible follow-up, not this ticket.

### CI (`.github/workflows/ci.yml`)
Replace the five steps after `npx prisma generate` (Verify api, Typecheck shared, Typecheck web, Test shared, Test web) with one step `run: npm run verify`. Everything else is unchanged: triggers, concurrency, pinned action SHAs, `npm ci`, explicit `prisma generate`, job id `verify` (so the required status check name is unchanged).

Tradeoffs:
- **Single job vs split jobs**: keep one job. Whole run is ~1-2 min; parallel jobs repeat `npm ci` + prisma generate each. Per-step failure attribution is lost, but npm prints the failing script and `&&` stops there. Revisit only if the run exceeds ~5 min.
- **Caching**: `setup-node` `cache: npm` already caches the npm download cache keyed on `package-lock.json`. No tsc incremental / vitest / `.svelte-kit` cache: gains of seconds do not pay for cache-key complexity.
- **Prisma generate stays a separate CI step**: it is an install-time concern, not a check, and is not part of local `verify` (developers already have a generated client).

### Spec-inclusive typecheck (decision Q2, optional in ticket)
Recommend in scope as its own commit (easy to drop if the reviewer wants it split). Probe result: `tsc` over `src` including `*.spec.ts` and `src/testing` has exactly 2 errors, both `config.get.mockReturnValue(...)` in `src/auctions/auction-scheduler.task.spec.ts` (lines 23, 51): `ConfigService.get` is overloaded, so the `DeepMockProxy` typing loses `mockReturnValue`.
- Fix the 2 errors in the spec with a typed mock access (no `any`; follow repo style, explicit types, no comments). The builder picks the narrowest typing that compiles, e.g. `vi.mocked(config.get)` or a typed `get` stub, and confirms the 94-file suite still passes.
- Add `tsconfig.typecheck.json`: `extends ./tsconfig.json`, `include: ["src"]`, `compilerOptions: { noEmit: true }`. Do not modify `tsconfig.build.json` (its spec/testing excludes keep specs out of `dist`). Root `tsconfig.json` has no `include` and swallows `web/`, so it cannot be the target.
- Point `typecheck` at it: `tsc -p tsconfig.typecheck.json`. `build` still uses `tsconfig.build.json`, so production compilation is still proven by `build`.
- If the fix turns out larger than the probe suggests (more than ~3 spec files, or non-trivial mock rework), drop this slice into a follow-up ticket and leave `typecheck` unchanged.

### README
Update the "Verification and git hooks" table (`verify`, `verify:fast`, `typecheck`, `typecheck:workspaces`, `test:workspaces`; typecheck row no longer says specs are excluded if Q2 lands), the pre-push sentence (now also covers shared/web), and the "CI (HYR-37)" block to `npm ci`, `npx prisma generate`, `npm run verify`. Remove the claim that verify excludes `web/`.

## Verification (builder)
- `npm run verify` exits 0 and prints, in order: lint, lint:arch, typecheck, shared check, web check, api tests, shared tests, web tests, build.
- Fail-fast: a temporary type error in `shared/src` stops verify before any test runs; a temporary failing web test stops before build. Revert afterwards.
- With Q2: temporarily add a type error in a `*.spec.ts`; `npm run typecheck` fails. Revert.
- `ci.yml` parses (`npx --yes yaml-lint` is not a dep; use `python3 -c 'import yaml'` or review by eye), and only the verify step remains after prisma generate. The real validation is the first PR run.
- Timing: `time npm run verify:fast` recorded in the PR description.

## Risks
- Workspace check scripts print noise; verify output gets longer. Accepted.
- `--if-present` silently skips a workspace whose script is renamed. Mitigation: README states the contract (`check`, `test` per workspace).
- CI first run on Linux previously validated lockfile natives (HYR-37); unchanged by this PR.

## Open questions for the coordinator / user
1. `verify:fast` contents: all of verify minus build (recommended) vs workspace tests only in `verify`.
2. Spec typecheck: in scope as a separate commit (recommended) vs follow-up ticket.
3. Workspace invocation: `--workspaces --if-present` (recommended) vs explicit `-w shared -w web`.
4. Keep single CI job (recommended) vs split into parallel jobs.
5. Add `web` `vite build` to verify? Recommend no (not in this ticket).

## Out of scope / follow-ups
- Web production build in verify/CI.
- Dependabot for action SHAs, coverage, branch protection settings.
