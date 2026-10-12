# Generate SvelteKit types on install (HYR-34)

## Problem
`web/tsconfig.json` extends `$app/tsconfig`, generated into `web/node_modules/$app/` by `svelte-kit sync`. Nothing runs it on install, so after `npm ci` on a fresh clone/worktree, root `npm run lint` fails with 41 parse errors in `web/src/**`.

## Decision
Add `"prepare": "svelte-kit sync"` to `web/package.json` scripts.

## Verified
In a clean export of HEAD with that one line added, root `npm ci` ran the workspace `prepare` (created `web/node_modules/$app/tsconfig.json`, plus `web/.svelte-kit/types`), and root `npm run lint` exited clean. Control: with `web/node_modules/$app` removed, root lint exits 1 with 43 errors. No root-level script needed.

## CI
No `.github/workflows` exists in the repo, so there is no CI to update.

## Out of scope
Lint rules, `web/tsconfig.json`, adding CI.
