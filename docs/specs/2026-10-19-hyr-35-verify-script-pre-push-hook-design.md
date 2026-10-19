# Verify script and pre-push hook (HYR-35)

## Problem
Checks (lint, arch lint, typecheck, tests, build) are run by hand from a README one-liner. Nothing stops a broken push. HYR-37 will add CI and needs one reusable entry point.

## Scope
Tooling only. No new lint rules or tests, no CI changes, no backend/web source changes.

## Design

### Scripts (root `package.json`)
- `typecheck`: `tsc -p tsconfig.build.json --noEmit`. Plain `tsconfig.json` has unrelated errors under `web/` and `shared/`, so the build config is the target. Web is not covered by this script (known gap, see Follow-ups).
- `verify:fast`: `npm run lint && npm run lint:arch && npm run typecheck && npm test`. `&&` gives fail-fast, in ticket order.
- `verify`: `npm run verify:fast && npm run build`. Order is therefore lint, lint:arch, typecheck, tests, build, with no duplicated list.
- CI (HYR-37) calls `npm run verify`.

### Hook install: core.hooksPath, no new dependency
- Tracked `.githooks/pre-push` (mode 100755), POSIX sh, runs `npm run verify:fast`. A non-zero exit blocks the push.
- Root `prepare` script sets `git config core.hooksPath .githooks`, guarded so it is a silent no-op when there is no git repo (Docker build stage with no `.git`, tarball installs, `npm ci` in a deployed image).
- Root `prepare` is independent of `web/package.json`'s `"prepare": "svelte-kit sync"` (HYR-34); both run on `npm ci`/`npm install`. No change to the web script.
- Not pre-commit, per ticket.

### Why not husky
Husky adds a pinned devDependency plus a `.husky/_` generated dir to do exactly one `git config core.hooksPath`. With one hook there is no gain. Revisit only if we need per-hook tooling like lint-staged (not planned).

### Tradeoffs checked
- **No `.git` (Docker/CI tarball)**: guard on `git rev-parse --git-dir` succeeding; otherwise skip, exit 0 so install never fails.
- **CI with `.git`**: config write is harmless. CI runs `verify` directly; the hook is never triggered by CI since it does not push.
- **Worktrees / Conductor workspaces**: `core.hooksPath` is stored in the shared common config (`.git/config` of the main repo), so one `prepare` run affects every worktree and the main checkout. A relative path is resolved from the top of whichever worktree runs the hook, so `.githooks` resolves correctly in each. Branches that lack `.githooks/` simply run no hooks (git ignores a missing dir). Conductor setup already runs `npm ci`, so new workspaces are covered with no `.conductor/settings.toml` change.
- **Existing custom `core.hooksPath`** (user-set elsewhere): prepare overwrites it. Accepted; documented in README. Not worth a conflict check.
- **Executable bit**: git tracks it; the plan commits the file with 755 and verifies via `git ls-files -s`.
- **Windows**: not supported (sh hook); Git for Windows ships sh so it works there too, no special handling.
- **Slow hook**: build excluded to keep pushes fast. Bypass: `git push --no-verify`.

### README
Replace step 5 of Local development with `npm run verify`. Add a "Verification and git hooks" section: script table (`verify`, `verify:fast`, `typecheck`), what the pre-push hook runs, that it installs automatically through `npm install`/`npm ci` via `core.hooksPath`, how to reinstall (`npm run prepare`), and the `git push --no-verify` bypass (emergencies only; CI will catch it).

## Verification (done by builder, not planner)
- `npm run verify` exits 0 on clean tree; breaking lint/typecheck/test each fails fast without later steps running.
- `git config core.hooksPath` is `.githooks` after `npm run prepare`; a push attempt with a failing check is blocked; `--no-verify` bypasses.
- `prepare` exits 0 in a directory with no `.git` (e.g. `GIT_DIR=/nonexistent npm run prepare --ignore-scripts=false`, or a clean export).

## Follow-ups (separate tickets, not footnotes)
- Typecheck web with `svelte-check` (`npm -w web run check`) in verify; needs web type errors triaged first.
- HYR-37: CI workflow calling `npm run verify`.

## Out of scope
New lint rules/tests, CI, husky/lint-staged, pre-commit hook.
