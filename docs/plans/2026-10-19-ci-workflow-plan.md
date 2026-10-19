# CI workflow (HYR-37) Implementation Plan

Spec: `docs/specs/2026-10-19-ci-workflow-design.md`

Size: ~55 lines (1 workflow ~45, README note ~10). Single PR, infra-only, no split needed.

### Task 1: confirm pins
- [ ] `git ls-remote --tags https://github.com/actions/checkout v7.0.1` -> `3d3c42e5aac5ba805825da76410c181273ba90b1`
- [ ] `git ls-remote --tags https://github.com/actions/setup-node v7.1.0` -> `949feb2413d6458794dcd2491c4babbbce0c15c1`

### Task 2: add `.github/workflows/ci.yml`
- [ ] Create with this content:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Generate prisma client
        run: npx prisma generate
      - name: Verify api
        run: npm run verify
      - name: Typecheck shared
        run: npm run check -w shared
      - name: Typecheck web
        run: npm run check -w web
      - name: Test shared
        run: npm test -w shared
      - name: Test web
        run: npm test -w web
```

- [ ] Verify locally in a clean state: `rm -rf node_modules web/node_modules && npm ci`, then run each step's command in order; all exit 0. Confirm `web/.svelte-kit` and `node_modules/.prisma/client` exist after `npm ci` and the generate step.
- [ ] Lint the YAML: `npx --yes actionlint` unavailable offline is fine; at minimum `node -e "require('node:fs')"`-free check via `gh workflow view` after push, or `actionlint` if installed.

### Task 3: README note
- [ ] Add a short "CI" section to `README.md`: what runs, that no DB is needed, command list to reproduce locally, and that `verify` should be a required check.

### Task 4: validate on GitHub (after branch `hyr-37` is pushed and PR opened)
- [ ] Confirm the `verify` job is green on the PR. If `npm ci` fails on Linux optional deps, regenerate lockfile entries.
- [ ] Manual: mark `verify` required in branch protection for `main`.

### Follow-up tickets (not in this PR)
- Root `typecheck` script covering specs (fix 2 errors in `src/auctions/auction-scheduler.task.spec.ts`).
- Fold shared/web checks and tests into `verify` so CI is a single call.
- Postgres service + `prisma migrate deploy` when integration tests are added.

Commit (stage and stop for `/crit` first): `ci: add github actions workflow for lint, typecheck and tests`
