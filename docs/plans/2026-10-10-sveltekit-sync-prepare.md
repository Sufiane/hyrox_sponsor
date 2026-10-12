# SvelteKit sync on prepare (HYR-34) Implementation Plan

Spec: `docs/specs/2026-10-10-sveltekit-sync-prepare-design.md`

### Task 1: add prepare script
- [ ] In `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/sparta/web/package.json` add to `scripts`: `"prepare": "svelte-kit sync"`. No dependency changes.
- [ ] Verify: `npm ci && ls web/node_modules/\$app/tsconfig.json` exists.
- [ ] Verify: root `npm run lint` exits 0 with no `$app/tsconfig` errors.
- [ ] Commit (stage and stop for `/crit` first per user workflow): `build(web): run svelte-kit sync on prepare`

No CI workflows exist; nothing else to change.
