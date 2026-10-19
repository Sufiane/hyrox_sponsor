# Verify script and pre-push hook (HYR-35) Implementation Plan

Spec: `docs/specs/2026-10-19-hyr-35-verify-script-pre-push-hook-design.md`

Size: ~60 lines total (package.json ~6, hook ~8, README ~35, plan-verification none). Fits one PR, one layer (tooling), no ticket split. Tooling only, no backend or frontend source.

Workflow notes: stage and stop for `/crit` before committing. Branch is `hyr-35` already. Move HYR-35 to In Progress at start, In Review when staged. Commits are conventional, ending with the Co-Authored-By line.

### Task 1: verify scripts
Files: `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/bangkok/package.json`
- [ ] Add scripts (no dependency changes):
  - `"typecheck": "tsc -p tsconfig.build.json --noEmit"`
  - `"verify:fast": "npm run lint && npm run lint:arch && npm run typecheck && npm test"`
  - `"verify": "npm run verify:fast && npm run build"`
- [ ] Verify: `npm run typecheck` exits 0; `npm run verify` exits 0 and prints steps in order lint, lint:arch, typecheck, test, build.
- [ ] Fail-fast check: temporarily introduce a lint error (revert after) and confirm `npm run verify` stops before lint:arch. Same idea for a failing test: typecheck/lint pass, build never runs. Do not leave the breakage in the tree.
- [ ] Commit: `build: add typecheck and verify scripts`

### Task 2: pre-push hook and auto-install
Files: `.githooks/pre-push` (new), `package.json`
- [ ] Create `.githooks/pre-push`:
  - `#!/bin/sh`, `set -e`, `exec npm run verify:fast` (run from repo top: `cd "$(git rev-parse --show-toplevel)"` first, so worktrees and subdirectory pushes work).
- [ ] `chmod +x .githooks/pre-push`; after `git add`, confirm `git ls-files -s .githooks/pre-push` shows `100755`.
- [ ] Add root script `"prepare": "git rev-parse --git-dir >/dev/null 2>&1 && git config core.hooksPath .githooks || true"`. (`|| true` is deliberate: install must never fail without git.) If the one-liner reads poorly, move to `scripts/install-hooks.sh` with the same logic; keep inline unless it exceeds one line of logic.
- [ ] Do not touch `web/package.json` `prepare`. Confirm `npm ci` still runs `svelte-kit sync` (`web/node_modules/$app/tsconfig.json` exists).
- [ ] Verify: `npm run prepare`, then `git config core.hooksPath` prints `.githooks`.
- [ ] Verify no-git case: copy tree via `git archive HEAD | tar -x -C <empty tmp dir>` plus the new files, run `npm run prepare` there; exit 0, no error output.
- [ ] Verify hook blocks: with a bare local remote (`git init --bare` in a tmp dir, add as remote), introduce a failing test on a throwaway commit, `git push` fails with hook output; `git push --no-verify` succeeds. Clean up the remote and the throwaway commit afterward.
- [ ] Verify worktree: from another worktree (`git worktree list`), `git config core.hooksPath` shows `.githooks` (shared config) and a push from there runs the hook.
- [ ] Commit: `build: add pre-push hook running verify:fast`

### Task 3: README
Files: `README.md`
- [ ] Local development step 5: replace with `npm run verify`.
- [ ] Add section "Verification and git hooks" after "Local development":
  - Table: `npm run verify` (lint, lint:arch, typecheck, test, build; fail-fast), `npm run verify:fast` (same without build), `npm run typecheck` (tsc on `tsconfig.build.json`; plain `tsconfig.json` has unrelated errors under `web/` and `shared/`).
  - Pre-push hook runs `verify:fast` (no build), tracked in `.githooks/`, installed by root `prepare` via `git config core.hooksPath .githooks` on `npm install`/`npm ci`; shared across worktrees; overwrites a custom `core.hooksPath`; reinstall with `npm run prepare`.
  - Bypass: `git push --no-verify`.
  - Note CI (HYR-37) should call `npm run verify`.
- [ ] Verify the README command names match package.json exactly.
- [ ] Commit: `docs: document verify script and pre-push hook`

### Final check
- [ ] `npm run verify` exits 0 on the final tree; `git status` clean of stray test artifacts (tmp remotes, breakages).
- [ ] Stage and stop; tell user to run `/crit`.

### Follow-up tickets to file (not part of this PR)
- Add web typecheck (`svelte-check`) to `verify`.
- HYR-37 CI uses `npm run verify`.
