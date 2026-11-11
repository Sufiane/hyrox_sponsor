# HYR-1 Stripe Connect Platform Setup - Implementation Plan (stacked subtasks)

Spec: `docs/specs/2026-10-31-hyr-1-stripe-connect-setup-design.md`
Date: 2026-10-31
Linear: slices A-E are HYR-43..HYR-47 (branches `hyr-43`..`hyr-47`, stack order A -> B -> C -> D -> E). Slices F-H moved out of HYR-1 into new ticket HYR-51 (athlete payout onboarding) as HYR-48 (F), HYR-49 (G), HYR-50 (H), blocked by the HYR-1 slices.

Confirmed decisions: Express accounts; US only; capture-at-close reinterpretation of manual capture (to be revisited in HYR-11); default payout schedule; no payout-readiness gate; athlete-initiated onboarding; two webhook endpoints; five required fail-closed env vars (`STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CONNECT_RETURN_URL`, `STRIPE_CONNECT_REFRESH_URL`) set in every environment before slice B merges.

## 0. Proposed ticket split and stack

Total estimate: about 2,500 changed lines (tests, migrations, docs included). Over the ~800 cap and spans schema, backend and web, so it is split into 8 subtasks (A-E under HYR-1, F-H under HYR-51), each <= ~450 lines, one layer, one actor.

Stacking: each PR branches off the previous one (A -> B -> C -> D -> E, branches `hyr-43`..`hyr-47`). Every subtask is green on its own (`npm run verify`, plus `npm run check -w web` / `npm test -w web` for H) and shippable on top of the previous one. F-H (HYR-48..HYR-50, ticket HYR-51) continue the stack after HYR-47 and are tracked outside HYR-1.

| # | Branch (Linear) | Title (conventional commit) | Layer | Est. lines | Depends on |
|---|---|---|---|---|---|
| A | `hyr-43` (HYR-43) | `docs(stripe): add hyr-1 spec, plan and connect setup runbook` | docs | ~250 (docs only; spec + plan already written) | main |
| B | `hyr-44` (HYR-44) | `feat(stripe): add stripe id constructors and env config` | backend (contract/config) | ~220 | A |
| C | `hyr-45` (HYR-45) | `feat(stripe): add stripe gateway port and sdk adapter` | backend | ~420 | B |
| D | `hyr-46` (HYR-46) | `feat(stripe): add webhook endpoints with signature check and event dedupe` | backend + schema | ~450 | C |
| E | `hyr-47` (HYR-47) | `feat(connect): add athlete payout readiness columns` | schema (+ db methods) | ~170 | A (parallel to C/D in theory, stacked after D) |
| F | `hyr-48` (HYR-48) | `feat(connect): add athlete onboarding link and status endpoints` | backend (athlete) | ~450 | C, E |
| G | `hyr-49` (HYR-49) | `feat(connect): sync athlete payout readiness from account.updated` | backend (webhook handler) | ~280 | D, E, F |
| H | `hyr-50` (HYR-50) | `feat(web): add athlete payouts onboarding page` | web (athlete) | ~400 | F (contract), G for live status |

Stack order is A -> B -> C -> D -> E -> F -> G -> H.

Notes on the split:
- A first (docs default shape); B and E are the "contract/schema" slices, C/D/F/G the backend slices, H the web slice.
- E has no code dependency on C/D (pure schema + db), so it could be built in parallel; it is stacked after D only to keep one linear chain and a simple migration timestamp order.
- H depends only on F's HTTP contract, so it can be built in parallel with G against a fake API; it merges after G because the status it displays is only meaningful once G syncs it.
- F-H (athlete payout onboarding) were split out of HYR-1 into HYR-51 (spec Q10 resolved). A-E stand alone and ship valuable infra for HYR-11/14.
- Follow-ups listed in spec section 8 are their own tickets, not part of any slice.

Per-PR rules for every slice: conventional-commit title; end commit message with the attribution line from the session; stage and stop for `/crit` before committing implementation; exact-pinned deps; explicit return types; `readonly` constructor params; no barrel files; no comments unless a non-obvious why; numeric separators on 5+ digit literals; snake_case error codes with a logger line at the throw site; Jest-style nested `describe('when ...')`.

---

## Slice A - docs

Branch `hyr-43`. Backend/frontend: neither. Size ~250.

Scope: commit the spec and plan; add runbook and README env section skeleton.

Files:
- `docs/specs/2026-10-31-hyr-1-stripe-connect-setup-design.md` (exists)
- `docs/plans/2026-10-31-hyr-1-stripe-connect-setup.md` (this file)
- `docs/runbooks/stripe-connect-setup.md` (new): dashboard checklist (Connect enable, Express, branding, two webhook endpoints and their secrets, test vs live keys, Stripe CLI forward commands for platform and connect channels, live-mode platform review note)
- `README.md`: "Stripe (HYR-1)" section stub linking the runbook; env table filled in by B.

Tasks:
- [ ] Write the runbook from spec 4.9 (verify dashboard wording against current Stripe docs).
- [ ] Add README stub.
- [ ] `npm run verify:fast` (no code change; confirms hooks pass).

Tests: none. Dependencies: none.

## Slice B - id constructors and env config

Branch `hyr-44`. Backend (contract/config). Size ~220.

Scope: validating constructors for Stripe ids, new required env vars with validation, `.env.example`, README env table. No SDK yet.

Files:
- Modify `src/common/stripe-ids.ts`: add `stripeConnectAccountId()`, `stripePaymentIntentId()`, `stripeCustomerId()` (prefix + non-empty + max length; throw `InvalidValueError('stripe_..._invalid')`).
- New `src/common/stripe-ids.spec.ts`.
- Modify `src/config/env.validation.ts`: `STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CONNECT_RETURN_URL`, `STRIPE_CONNECT_REFRESH_URL`; rule: the two webhook secrets must differ (log `stripe_webhook_secrets_must_differ`, throw `env_invalid`).
- Modify `src/config/env.validation.spec.ts`: add Stripe vars to `validEnv`, new cases.
- Modify `.env.example`, `README.md`.
- Any other spec or CI env that builds the full config gets the new vars (grep for `validEnv`/`STORAGE_BUCKET` usages in tests).

Tasks:
- [ ] Failing specs for constructors (valid, wrong prefix, empty, too long, trims).
- [ ] Implement constructors.
- [ ] Failing env specs (each var missing/invalid -> `env_invalid`; log names variable but not value; secrets-differ).
- [ ] Implement validation; update fixtures, `.env.example`.
- [ ] `npm run verify`.

Tests: described above. Deploy note in PR: set all five vars in every environment before merging.

## Slice C - gateway port and adapter

Branch `hyr-45`. Backend. Size ~420.

Scope: `stripe` SDK (exact-pinned), `StripeGateway` abstract port, `StripeAdapter` (only SDK importer), `StripeModule`, errors, arch rule. No controllers.

Files:
- `package.json` / `package-lock.json`: add `stripe` at exact version (install, then strip caret; read resolved version from lockfile).
- New `src/stripe/stripe-gateway.ts` (abstract class + `ConnectAccountSnapshot`, `StripeEvent`, input types).
- New `src/stripe/stripe.adapter.ts`, `src/stripe/stripe.adapter.spec.ts`.
- New `src/common/stripe-errors.ts` (`StripeUnavailableError` 502 `stripe_unavailable`, `StripeRejectedError` 422 `stripe_request_rejected`, `StripeMisconfiguredError` 502 `stripe_misconfigured` for Stripe authentication/permission failures (revoked key or missing Connect permission, needs a human; logged at error level); extend the `DomainError` base in `src/common/domain-error.ts`; confirm `DomainErrorFilter` maps the status, extend its table if needed with spec).
- New `src/stripe/stripe.module.ts` (provides `StripeGateway` via `StripeAdapter`, exports it; reads config via `ConfigService`).
- Modify `.dependency-cruiser.cjs`: rule `no-stripe-sdk-outside-stripe-adapter` (from `^src/` except `^src/stripe/stripe\.adapter\.ts$` to `node_modules/stripe`).
- Modify `src/app.module.ts`: import `StripeModule`.
- Modify `src/common/domain-error.filter.ts` + spec only if status mapping needs it.

Tasks:
- [ ] Failing adapter specs with a mocked `stripe` module: account create request shape (type, country, business_type, transfers capability, payout schedule constant, metadata, idempotency key `connect-account:<athleteId>`), account link shape, retrieve -> snapshot (branded id, `requirementsDue`, `disabledReason`), webhook construct (valid, bad signature -> `stripe_signature_invalid`, channel picks the right secret), error mapping (connection/api/rate-limit -> unavailable; card/invalid-request -> rejected), raw message only to logger.
- [ ] Implement adapter; pinned API version constant; `maxNetworkRetries`, `timeout`.
- [ ] Add arch rule; verify `npm run lint:arch` fails if SDK is imported elsewhere (temporary local check, not committed).
- [ ] `npm run verify`.

Tests: adapter unit only (no network). Dependencies: B.

## Slice D - webhook endpoints and event log

Branch `hyr-46`. Backend + one additive migration. Size ~450.

Scope: raw-body webhook receive, signature verification via gateway, persisted dedupe, handler registry. No handlers yet.

Concurrency and retry: the event row carries a nullable `claimed_at` lease. After insert, the service claims the row (`claim(id, now - 60s)`: only when unprocessed and unclaimed or claimed before the lease cutoff); a failed claim means the event is done or in flight and returns 200 without dispatch, so concurrent duplicates run the handler once. Only success sets `processedAt`; on handler failure the service releases the claim (`release(id)`: `claimed_at = null` where unprocessed) and returns 500, so Stripe's immediate retry re-claims and re-dispatches. Lease expiry covers a crash between claim and release. Events with no registered handler are still marked processed: handlers re-read current state from Stripe, so skipping past unhandled events is safe.

Files:
- Modify `prisma/schema.prisma`: `StripeWebhookEvent` model (incl. `claimedAt`) + `StripeWebhookChannel` enum (`@@map` snake_case); new migration under `prisma/migrations/2026110x.../`.
- Modify `src/main.ts`: `NestFactory.create(AppModule, { rawBody: true })`.
- New `src/stripe/webhooks/stripe-webhook.controller.ts` (+ spec): two routes, `@SkipThrottle()`, no auth guard, 200 empty body.
- New `src/stripe/webhooks/stripe-webhook.service.ts` (+ spec): verify, record, dispatch, mark processed.
- New `src/stripe/webhooks/stripe-webhook-event.db.ts` (+ spec): `insertIfNew` (return `false` on `P2002` via `src/common/prisma-error-codes.ts`), `claim`, `release`, `markProcessed`.
- New `src/stripe/webhooks/stripe-event-handler.ts`: abstract/token for the multi-provider handler interface (`handles(type)`, `handle(event)`).
- Modify `src/stripe/stripe.module.ts` to register controller, service, db, handler token (empty list). Needs `PrismaModule`.
- New `stripe-webhook.int.spec.ts`: concurrent duplicate event ids -> one row, handler called once.

Tasks:
- [ ] Failing service specs by condition: valid new event, duplicate event (claim fails, no dispatch), bad signature (400 `stripe_signature_invalid`), handler throws (500, row stays unprocessed, retry re-dispatches), no matching handler (processed, logged at debug).
- [ ] Implement db, service, controller, module wiring, `rawBody`.
- [ ] Controller spec via Nest testing proves JSON body parsing on another route is unchanged.
- [ ] Migration applied locally; `npx prisma generate`; `npm run verify`; `npm run test:integration` for the int spec.
- [ ] Manual check with `stripe listen` for both channels (record result in PR description, not CI).

Dependencies: C.

## Slice E - athlete readiness columns

Branch `hyr-47`. Schema + db methods only. Size ~170.

Scope: additive migration and the db accessors F/G need. No endpoints.

Files:
- Modify `prisma/schema.prisma` `Athlete`: `stripeConnectAccountId String? @unique`, `stripeConnectDetailsSubmitted Boolean @default(false)`, `stripeConnectPayoutsEnabled Boolean @default(false)`, `stripeConnectSyncedAt DateTime?` (all `@map` snake_case, `Timestamptz(3)`).
- New migration (unique index creation guarded: all existing values are NULL, which Postgres allows multiple of).
- Modify `src/athletes/athlete.db.ts` (+ spec): `setStripeConnectAccountIdIfUnset(id, accountId)` (CAS via `updateMany where stripeConnectAccountId null`, returns record), `findByStripeConnectAccountId(accountId)`, `updateConnectReadiness(id, { detailsSubmitted, payoutsEnabled, syncedAt })`. Brand at the db boundary.
- New `src/connect/connect-status.ts` (+ spec): pure `connectStatus(athleteRecord): 'NOT_STARTED' | 'INCOMPLETE' | 'RESTRICTED' | 'READY'`.
- Update `shared/` types only if a web-visible status type is wanted (decide in H; keep the literal union here).

Tasks:
- [ ] Failing specs for `connectStatus` (each state) and db methods (prisma mock pattern used by `bidder.db`).
- [ ] Schema + migration + generate; implement.
- [ ] `npm run verify`.

Dependencies: A only (schema), stacked after D.

## Slice F - onboarding link and status endpoints

Branch `hyr-48`. Backend, athlete actor. Size ~450.

Scope: module `src/connect/` with controller -> service -> db (db = existing `AthleteDb` methods through a narrow `ConnectDb` that wraps them, or reuse `AthleteDb` via `AthletesModule` export - choose reuse unless the interface is wider than 3 methods; say which in the PR).

Files:
- New `src/connect/connect.controller.ts` (+ spec): `POST /athletes/me/connect/onboarding-link`, `GET /athletes/me/connect/status`, `JwtAuthGuard`, `CurrentAthleteId`, per-route throttle on the POST.
- New `src/connect/connect.service.ts` (+ spec): `createOnboardingLink(athleteId)`, `getStatus(athleteId)`.
- New `src/connect/connect.module.ts`: imports `StripeModule`, `AthletesModule`, `AuthModule` (guard).
- New `src/connect/dto/onboarding-link-response.ts`, `connect-status-response.ts`.
- Account id persistence: store with a compare-and-set write and treat an existing stored id as authoritative (the idempotency key `connect-account:<athleteId>` only protects ~24h).
- `setStripeConnectAccountIdIfUnset` returns null for athlete missing, id already stored, or id taken by another athlete (unique violation): the service must `findById` and treat the stored id as authoritative.
- Modify `src/app.module.ts`.
- README "Connect" route table.
- `connect.int.spec.ts`: two concurrent link requests produce exactly one stored account id.

Tasks (by condition describes):
- [ ] when athlete missing -> 404 `athlete_not_found`; banned -> 403 `athlete_banned`; not adult -> 403 `athlete_not_adult`.
- [ ] when no account yet -> creates via gateway, stores via CAS, returns link.
- [ ] when CAS loses race -> uses stored id, still returns link (extra Stripe account is orphaned: gateway idempotency key prevents it in practice; document).
- [ ] when account exists -> no create call, link only; READY athletes still get a link.
- [ ] when Stripe unavailable -> 502 `stripe_unavailable`, nothing stored.
- [ ] status: each of 4 states, never calls Stripe; response is `{ status }` only (`requirementsDue` deferred: needs a column filled by slice G). Done in HYR-54: response is `{ status, requirementsDue: string[] | null }`, column `athletes.stripe_connect_requirements_due` (jsonb, NULL = never synced) written by `syncReadiness`.
- [ ] `npm run verify`, `npm run test:integration`.

Dependencies: C, E.

## Slice G - account.updated sync

Branch `hyr-49`. Backend, webhook. Size ~280.

Scope: handler registered on the connect channel that refreshes readiness.

Files:
- New `src/connect/connect-account-updated.handler.ts` (+ spec): implements `StripeEventHandler`, `handles('account.updated')`.
- Modify `src/connect/connect.module.ts` to register the handler under the handler multi-provider token (export/import wiring with `StripeModule`; avoid a circular import by having the token live in `src/stripe/webhooks/`).
- Modify README (Stripe events handled table).
- `account-updated.int.spec.ts` optional: event twice -> same final row.

Tasks:
- [ ] when athlete unknown for account id -> warn log, no write, resolves (200).
- [ ] when known -> `retrieveAccount`, write submitted/payoutsEnabled/syncedAt.
- [ ] when processed twice or out of order -> same end state (reads current Stripe state).
- [ ] when Stripe retrieve fails -> throws so webhook returns 500 and Stripe retries.
- [ ] `npm run verify`.

Known gap (accepted): an `account.updated` that arrives before the account id is stored on the athlete is dropped (warn, 200); readiness self-heals on the next event for that account. A reconciliation job is a follow-up.

Dependencies: D, E, F.

## Slice H - web payouts page

Branch `hyr-50`. Frontend (`web/`), athlete actor. Size ~400.

Scope: `/account/payouts` page; API client; return/refresh handling. No visual design polish.

Files:
- New `web/src/routes/account/payouts/+page.svelte` (+ `+page.ts` if load needed).
- New `web/src/lib/connect/connect-api.ts` (+ spec) using `authed-fetch`: `fetchConnectStatus`, `requestOnboardingLink`.
- New `web/src/lib/connect/PayoutsPanel.svelte` (+ spec): status badge (from `{ status }` only; no requirements list), start/continue button, loading/error states, `return=1` polling (bounded retries, e.g. 5 x 2s), `refresh=1` auto-requests a new link.
- New `web/src/lib/connect/connect-errors.ts` (+ spec): map error codes (`athlete_banned`, `athlete_not_adult`, `stripe_unavailable`, ...) to messages, same style as `auth-errors`.
- Link from the account area nav/page.
- `web/` env docs: return/refresh URLs must match `STRIPE_CONNECT_RETURN_URL` / `STRIPE_CONNECT_REFRESH_URL` (README note, no new web env unless the BFF needs one).

Tasks:
- [ ] api client specs (success, 401 refresh path through `authed-fetch`, error code passthrough).
- [ ] panel specs by condition: each of 4 statuses, click -> redirect to returned url, return polling stops on READY or after max tries, refresh param requests a link, error code shown.
- [ ] `npm run check -w web`, `npm test -w web`, root `npm run lint`.

Dependencies: F contract (build against a fake), merge after G.

---

## Backend / frontend independence

- Backend slices A-G are strictly sequential in the stack, but E is code-independent of C/D and could be dispatched in parallel to a second backend builder.
- Web slice H is independent of backend implementation after F's contract is fixed (`POST /athletes/me/connect/onboarding-link -> { url, expiresAt }`, `GET /athletes/me/connect/status -> { status }`; `requirementsDue` deferred to a follow-up needing a column filled by slice G; delivered in HYR-54), so `frontend-builder` can work in parallel with G. Merge order in the stack stays G then H.

## Out of scope reminders (do not absorb)

PaymentIntents, Customer/card capture, escrow rows, capture/transfer/refund, commission math (HYR-11/HYR-14); gating auctions on readiness; email verification; reconciliation job; staff view; event log retention. See spec section 8.

## Self-review checklist for the plan

- Every slice leaves `npm run verify` green and is deployable (new required env vars land in B and must be set first; migrations in D and E are additive).
- No slice imports the Stripe SDK outside `src/stripe/stripe.adapter.ts`.
- No `*.service.ts` or `*.usecase.ts` imports Prisma; branded casts only in `*.db.ts` and the adapter.
- Sizes re-estimate after each merge; if any slice passes ~600 lines, split it (D: log+registry vs controller; F: link vs status).
