# Fold shared/web checks into verify (HYR-41) Implementation Plan

Spec: `docs/specs/2026-10-31-hyr-41-fold-workspace-checks-into-verify-design.md`

## Size and split
Fits one PR, under the cap. One layer (tooling), no actor split. Estimate: package.json ~8 lines, ci.yml -12/+2, README ~20, tsconfig.typecheck.json ~6, spec fix ~4. Total ~50 lines of change, excluding the spec and plan docs. No ticket split needed. Task 3 (spec typecheck) is a separable commit and may move to a follow-up ticket per spec Q2.

Dependencies: Task 1 -> Task 2 (CI calls the new verify) -> Task 4 (docs describe final state). Task 3 is independent of 1 and 2 but must land before Task 4 documents it.

Workflow: move HYR-41 to In Progress at start, In Review once staged. Stage and stop for `/crit` before committing. Conventional commits ending with the Co-Authored-By line. Branch is already `hyr-41`. No new dependencies (nothing to pin).

### Task 1: workspace scripts and verify wiring
Files: `package.json`
- [ ] Add scripts `typecheck:workspaces` = `npm run check --workspaces --if-present` and `test:workspaces` = `npm test --workspaces --if-present`.
- [ ] Rewrite `verify:fast` = `npm run lint && npm run lint:arch && npm run typecheck && npm run typecheck:workspaces && npm test && npm run test:workspaces`. Leave `verify` as `npm run verify:fast && npm run build`.
- [ ] Verify: `npm run typecheck:workspaces` and `npm run test:workspaces` each exit 0 and show both shared and web running (50 and 358 tests).
- [ ] Verify: `npm run verify` exits 0, steps in spec order.
- [ ] Fail-fast: temporary type error in `shared/src/body-zone.ts` makes `verify:fast` stop before tests; temporary failing web test stops before build. Revert both, confirm `git status` shows only intended files.
- [ ] Commit: `build: run shared and web checks in verify`

### Task 2: simplify CI
Files: `.github/workflows/ci.yml`
- [ ] Remove steps "Verify api", "Typecheck shared", "Typecheck web", "Test shared", "Test web". After "Generate prisma client" add one step `name: Verify`, `run: npm run verify`. Touch nothing else (SHAs, triggers, job id `verify`, timeout).
- [ ] Verify: diff shows only that step block changed; YAML still parses.
- [ ] Commit: `ci: replace per-workspace steps with npm run verify`

### Task 3: spec-inclusive api typecheck (separable; see spec Q2)
Files: `src/auctions/auction-scheduler.task.spec.ts`, `tsconfig.typecheck.json` (new), `package.json`
- [ ] Reproduce first: `npx tsc -p <tsconfig.typecheck.json> --noEmit` reports exactly the 2 errors (lines 23, 51 of the spec). If more than ~3 spec files error, stop and move this task to a follow-up ticket.
- [ ] Fix the 2 errors in the spec with a narrow typed mock access (no `any`, no comments, explicit types per repo style). Run `npx vitest run src/auctions/auction-scheduler.task.spec.ts` before and after; same tests pass.
- [ ] Create `tsconfig.typecheck.json`: `{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }`. Leave `tsconfig.build.json` untouched.
- [ ] Set `typecheck` = `tsc -p tsconfig.typecheck.json`.
- [ ] Verify: `npm run typecheck` exits 0; temporary type error in any `*.spec.ts` makes it fail (revert); `npm run build` still exits 0 and `dist/` contains no spec files.
- [ ] Commit: `test(auctions): fix scheduler spec mock typing` then `build: typecheck specs and test helpers`

### Task 4: README
Files: `README.md`
- [ ] Update the verification table: `verify` and `verify:fast` rows list the new steps; add `typecheck:workspaces` and `test:workspaces` rows noting the `--workspaces --if-present` contract (each workspace exposes `check` and `test`). Update the `typecheck` row (drop "excludes spec files and web/" if Task 3 landed; keep a note that web is covered by `typecheck:workspaces`).
- [ ] Pre-push sentence: now runs api and shared/web checks and tests (no build).
- [ ] CI block: reduce to `npm ci`, `npx prisma generate`, `npm run verify`; "run the same commands locally" stays.
- [ ] Verify every command name in the README exists in package.json.
- [ ] Commit: `docs: document workspace checks in verify`

### Final check
- [ ] `time npm run verify:fast` and `npm run verify` both exit 0; record the timing for the PR description.
- [ ] `git status` has no stray artifacts. Stage and stop; tell the user to run `/crit`.
- [ ] After merge (manual, not in this PR): confirm first CI run is green and the `verify` required check is still named `verify`.

### Follow-ups to file (not in this PR)
- Web `vite build` in verify/CI.
- If Task 3 is split out: spec-inclusive typecheck ticket.
