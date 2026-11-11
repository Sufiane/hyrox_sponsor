# HYR-1: Stripe Connect Platform Setup (US, manual capture + delayed payout) - Design Spec

Status: PROPOSED. Ticket HYR-1 had no description. Scope below is inferred from the title, the locked product context in `docs/specs/2026-09-28-core-data-model-design.md` section 2, and the existing code. Open points are listed in section 9.
Linear: slices A-E are HYR-43..HYR-47 (branches `hyr-43`..`hyr-47`). Slices F-H (athlete onboarding API, `account.updated` sync, web page) moved out to ticket HYR-51 as HYR-48..HYR-50, blocked by the HYR-1 slices.
Confirmed decisions (user): Express (Q1); capture-at-close reinterpretation of manual capture, to be revisited in HYR-11 (Q2); default payout schedule (Q3); no readiness gate (Q4); athlete-initiated onboarding (Q5); two webhook endpoints (Q6); US only (Q8); five required fail-closed env vars set in every environment before slice B merges (Q9).
Plan: `docs/plans/2026-10-31-hyr-1-stripe-connect-setup.md` (subtask list, order, sizes, branches).
Date: 2026-10-31
Depends on: nothing unmerged (schema, bids, auction close and branded Stripe ids all exist). Blocks: HYR-11 (Stripe hold on leading bid), HYR-14 (capture, payout, refund).

## 1. Context (what exists today)

- No Stripe SDK dependency, no Stripe env vars, no Stripe code. Only references: `src/common/stripe-ids.ts` (type-only brands `StripePaymentIntentId`, `StripeCustomerId`, `StripeConnectAccountId`, no validating constructors), `Bidder.stripeCustomerId` (unique, nullable, `BidderService.attachStripeCustomer` already handles the race), `Athlete.stripeConnectAccountId` (nullable, NOT unique, no index), `EscrowTransaction.stripePaymentIntentId` + type enum `AUTHORIZED/VOIDED/CAPTURED/REFUNDED/FAILED`.
- Bids are non-binding until HYR-11; `PlaceBidUsecase.execute` returns `previousLeader` as the seam for void/authorize.
- Auction close (HYR-8) sets `outcome = AWAITING_PROOF` + `proofDeadlineAt` or `NO_SALE`. Bid-time authorization means a hold can be up to ~14 days old at close (HYR-8 note).
- Config pattern: `class-validator` `EnvironmentVariables` in `src/config/env.validation.ts`, fail-closed at boot (`env_invalid`), `.env.example`, README env docs.
- Third-party SDK pattern: abstract port + single adapter file (`src/storage/document-storage.ts` + `s3-document-storage.ts`), enforced by dependency-cruiser rule `no-aws-sdk-outside-storage-adapter`.
- Hexagonal split (`*.service.ts` / `*.db.ts`), `DomainErrorFilter`, snake_case codes, `JwtAuthGuard` for athlete routes, global `ThrottlerGuard`, BFF + httpOnly refresh cookie on the web side.
- Account area on web: `web/src/routes/account/entries`.

## 2. Goal and scope

HYR-1 is the platform foundation, not the money flow. After it merges: the platform can talk to Stripe safely, receive verified webhooks, and an athlete can onboard a US Express connected account and the app knows whether that account can receive payouts.

In scope:
1. Stripe SDK pinned, env config, validating Stripe id constructors, dependency-cruiser rule confining the SDK to one adapter.
2. `StripeGateway` port + `StripeAdapter` (account create, account link create, account retrieve, webhook event construction). Idempotency keys, pinned API version, error mapping.
3. Webhook endpoint(s): raw-body signature verification, persisted event log for dedupe, handler registry for later tickets.
4. Athlete Connect onboarding: create Express account (US, individual, `transfers` capability, delayed-payout settings), hosted onboarding link, payout-readiness state on `athletes`, sync from `account.updated`.
5. Web: athlete "payouts" page that starts/resumes onboarding and shows readiness.
6. Runbook: what must be configured in the Stripe dashboard.

Out of scope (separate tickets):
- PaymentIntent create/capture/cancel/refund, bidder Customer + card collection, `EscrowTransaction` writes: HYR-11 (hold) and HYR-14 (capture, transfer/payout, refund). The gateway port gets those methods in those tickets.
- Commission math (15%, $5 min) applied at capture: HYR-14.
- Gating auctions or bids on athlete payout readiness (see Q4).
- Email verification before onboarding (deferred in the auth spec to HYR-14, see Q7).
- Non-US athletes, non-USD currency, Standard/Custom accounts.

## 3. Approaches considered

Connect account type:
- A. Express (chosen). Stripe-hosted onboarding and dashboard, KYC handled by Stripe, platform controls payout schedule, individuals (athletes) fit. Platform carries negative-balance/dispute liability, which the escrow model already assumes.
- B. Standard. Athlete owns the relationship, platform cannot control payout timing, which breaks "delayed payout". Rejected.
- C. Custom. Platform builds all KYC UI and carries compliance. Overkill. Rejected.

Fund flow (decides what HYR-1 must configure; implemented in HYR-11/14):
- A. Separate charges and transfers (chosen): leader holds a manual-capture authorization, captured at close, funds sit in platform balance, `Transfer` to the athlete after proof is verified, refund if not. Auth hold expiry stops mattering after close. Needs the athlete account to have the `transfers` capability only.
- B. Destination charges with manual capture and `on_behalf_of`. Hold must survive to proof time (days after race), far beyond the card auth window. Not viable (see Q2).
- C. Direct charges. Funds land on the athlete account immediately, no escrow. Rejected.

Webhook endpoint layout:
- A. Two routes sharing one service: `POST /stripe/webhooks/platform` and `POST /stripe/webhooks/connect`, each with its own signing secret (chosen). Stripe issues a separate secret per endpoint and Connect-account events (`account.updated` for connected accounts) need a "listen to events on connected accounts" endpoint.
- B. One route with try-both secrets. Hides misconfiguration. Rejected.

Splitting for review (see plan): docs, then config/contract, then adapter, then webhook, then schema, then onboarding, then sync, then web. Each backend slice is one layer and one actor.

## 4. Design

### 4.1 Stripe ids and money

`src/common/stripe-ids.ts` gains validating constructors: `stripeConnectAccountId` (prefix `acct_`), `stripePaymentIntentId` (`pi_`), `stripeCustomerId` (`cus_`). They throw only the snake_case code (`stripe_connect_account_id_invalid`, ...) via `InvalidValueError`, never log. Amounts are `Cents` (`src/common/money.ts`, USD, integer cents); nothing in HYR-1 moves money.

Branding happens only in the adapter (values from Stripe) and `*.db.ts` (values from Prisma), never in services.

### 4.2 Config

New env vars in `EnvironmentVariables`, all required (fail-closed like storage):

| Var | Rule |
|---|---|
| `STRIPE_SECRET_KEY` | starts with `sk_` or `rk_`, min length; never logged |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | starts with `whsec_` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | starts with `whsec_`, must differ from the platform one |
| `STRIPE_CONNECT_RETURN_URL` | URL (require_tld false), athlete lands here after onboarding |
| `STRIPE_CONNECT_REFRESH_URL` | URL, used when a link expired or was already used |

`.env.example` gets obviously fake test values; README gets an env table and the runbook pointer. API version is a constant in the adapter (pinned, bumped deliberately), not env.

### 4.3 Port and adapter

```ts
export abstract class StripeGateway {
  abstract createExpressAccount(input: { athleteId: AthleteId; email: NormalizedEmail }): Promise<ConnectAccountSnapshot>;
  abstract createOnboardingLink(accountId: StripeConnectAccountId): Promise<{ url: string; expiresAt: Date }>;
  abstract retrieveAccount(accountId: StripeConnectAccountId): Promise<ConnectAccountSnapshot>;
  abstract constructWebhookEvent(rawBody: Buffer, signature: string, channel: 'platform' | 'connect'): StripeEvent;
}

export type ConnectAccountSnapshot = {
  id: StripeConnectAccountId;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  transfersActive: boolean;
  requirementsDue: readonly string[];
  disabledReason: string | null;
};
```

`StripeAdapter` (`src/stripe/stripe.adapter.ts`) is the only file importing `stripe`. It:
- sets `apiVersion` to a pinned constant, `maxNetworkRetries: 2`, `timeout`;
- sends idempotency key `connect-account:<athleteId>` on account creation so a retry or double-click can never create two accounts;
- creates accounts with `type: 'express'`, `country: 'US'`, `business_type: 'individual'`, `capabilities: { transfers: { requested: true } }`, `settings.payouts.schedule` from a single named constant (see Q3), `metadata: { athleteId }`;
- maps every Stripe error to `StripeUnavailableError` (`stripe_unavailable`, 502) or `StripeRejectedError` (`stripe_request_rejected`, 422); the raw message and Stripe request id go to the logger, never to the client;
- brands all returned ids and exposes `StripeEvent` as a narrow own type (`id`, `type`, `created`, `accountId | null`, `data`), so no SDK type leaks past the adapter.

Dependency-cruiser rule `no-stripe-sdk-outside-stripe-adapter` mirrors the AWS one. `StripeModule` provides `{ provide: StripeGateway, useClass: StripeAdapter }` and exports it. Tests use a fake gateway; the adapter itself is tested with a mocked `stripe` module.

### 4.4 Webhooks

- `NestFactory.create(AppModule, { rawBody: true })`; controller reads `request.rawBody`. Other routes unaffected.
- `StripeWebhookController`: `POST /stripe/webhooks/platform` and `/connect`, no `JwtAuthGuard`, `@SkipThrottle()`. Missing/invalid signature -> 400 `stripe_signature_invalid` (logged at warn with no body).
- `StripeWebhookService`: verify via gateway, then insert into `stripe_webhook_events` (`id` = Stripe event id PK, `type`, `channel`, `receivedAt`, `processedAt` nullable). Duplicate id (unique violation, `P2002`) -> 200 no-op. Then dispatch to handlers registered through a `StripeEventHandler` multi-provider interface (`handles(type)`, `handle(event)`), mark `processedAt`. Handler failure -> 500 so Stripe retries; the row stays unprocessed and a retry re-dispatches (handlers must be idempotent). No handlers ship in slice D; slice G registers `account.updated`.
- Stripe retries for up to 3 days with backoff, so out-of-order delivery is expected: handlers re-read current state (`retrieveAccount`) instead of trusting event payload ordering.

### 4.5 Schema

One additive migration for the event log, one for athlete readiness (separate slices):
- `stripe_webhook_events(id text pk, type text, channel enum, received_at timestamptz, processed_at timestamptz null)`.
- `athletes`: unique index on `stripe_connect_account_id` (column exists; verify no duplicate data, it is null everywhere today), plus `stripe_connect_details_submitted bool default false`, `stripe_connect_payouts_enabled bool default false`, `stripe_connect_synced_at timestamptz null`.
- Derived status for API/UI: `NOT_STARTED` (no account id), `INCOMPLETE` (account, details not submitted), `RESTRICTED` (submitted but payouts disabled), `READY` (payouts enabled). Computed in the service, not stored, so it cannot drift.

### 4.6 Athlete onboarding API (module `src/connect/`)

Hexagonal: `connect.controller.ts` -> `connect.service.ts` -> `connect.db.ts`; Stripe only via `StripeGateway`. The flow is simple orchestration, so no usecase layer.

- `POST /athletes/me/connect/onboarding-link` (JwtAuthGuard): load athlete (404 `athlete_not_found`), refuse banned (403 `athlete_banned`) and non-adult (403 `athlete_not_adult`). If no account id: create via gateway, then `setStripeConnectAccountIdIfUnset` (same compare-and-set pattern as `BidderDb.setStripeCustomerIdIfUnset`); if the CAS loses the race, use the stored id. Create account link, return `{ url, expiresAt }`. A `READY` athlete still gets a link (Stripe account-update flow) - never an error.
- `GET /athletes/me/connect/status` (JwtAuthGuard): returns `{ status }`. Reads DB only and never calls Stripe (webhook is the sync path), keeping the GET cheap. `requirementsDue` was deferred to a follow-up (HYR-54, done): the response is `{ status, requirementsDue: string[] | null }` read from the nullable jsonb column `athletes.stripe_connect_requirements_due`, filled by the `account.updated` sync under the same stale-write guard (NULL = never synced, `[]` = nothing due). A `?refresh=true` is rejected as scope creep; the return page polls status (see 4.8).
- Throttle: stricter per-athlete limit on the link route (it hits Stripe).
- Error codes: `athlete_not_found`, `athlete_banned`, `athlete_not_adult`, `stripe_unavailable`, `stripe_request_rejected`.

### 4.7 `account.updated` sync

`ConnectAccountUpdatedHandler` (registered as a `StripeEventHandler`): resolve athlete by `stripeConnectAccountId` (unknown account -> log warn, no-op, 200), call `retrieveAccount`, write `detailsSubmitted`, `payoutsEnabled`, `syncedAt` in one update. Idempotent and order-insensitive.

### 4.8 Web

`/account/payouts` page behind `AuthGate`, using existing `authed-fetch`:
- shows status badge from `GET status`;
- button calls `POST onboarding-link`, then `window.location = url`;
- `STRIPE_CONNECT_RETURN_URL` points to `/account/payouts?return=1`, which polls status a few times (webhook may lag) then shows the result; refresh URL points to `/account/payouts?refresh=1` and auto-requests a fresh link.
Final visual design stays out (consistent with prior web tickets); reuse existing form/button classes.

### 4.9 Runbook (docs slice)

Dashboard checklist: enable Connect (US platform), Express, platform profile + branding, set the Connect onboarding return domains, create the two webhook endpoints (platform events; connected-account events) and copy their secrets, test-mode vs live-mode key separation, Stripe CLI `stripe listen --forward-to` commands for local dev with both channels, and a note that live-mode needs Stripe's Connect application review before onboarding real athletes.

## 5. Testing strategy

- Unit: id constructors, env validation (each new var, the secrets-differ rule, no secret in logs), adapter with mocked SDK (request shapes, idempotency key, error mapping, branding), webhook service (valid, bad signature, duplicate, handler failure, unprocessed retry), connect service with fake gateway + mocked db (each `describe` per condition, repo Jest-style nesting), handler (known account, unknown account, stale event), `ConnectDb`/`StripeWebhookEventDb` with the existing prisma mock pattern.
- Integration (`*.int.spec.ts`, existing throwaway-DB helper): duplicate webhook insert race; concurrent `onboarding-link` calls produce one stored account id.
- Architecture: `npm run lint:arch` proves the SDK is confined.
- Web: component and api-client specs, same style as `LoginForm`/`auth-api`.
- Manual (documented, not CI): Stripe test mode end-to-end with CLI forwarding. CI has no Stripe network access and none is added.

## 6. Risks

- Dashboard/ops config is half of this ticket and is invisible in code review: the runbook slice is first so reviewers can follow it.
- New required env vars break boot until set: call out in the PR descriptions of slice B, and set test keys in every environment before merging B.
- Webhook raw body: enabling `rawBody` must not change JSON parsing for other routes (covered by a controller spec using Nest testing).
- Live-mode Connect needs Stripe platform review; do not promise a launch date from code completion.

## 7. Compatibility / data

All migrations additive. Existing athletes keep `stripeConnectAccountId = null` -> `NOT_STARTED`. No backfill.

## 8. Follow-ups (own tickets, not footnotes)

1. Auctions/bids gate on athlete payout readiness (or a nudge/deadline policy) - Q4.
2. Email verification before onboarding - Q7.
3. Reconciliation job: periodically `retrieveAccount` for `INCOMPLETE` athletes older than N days to heal lost webhooks.
4. Staff view of an athlete's connect status.
5. Webhook event log retention/cleanup job.
6. Webhook alerting on repeated handler failure.

## 9. Open design questions and recommended answers

1. Account type: Express vs Standard vs Custom. Recommend Express (section 3).
2. Manual-capture auth-hold expiry vs auction timing. Card authorizations are roughly 7 days by default; extended authorization exists but is limited by card network/merchant category and not guaranteed. The leading bid is authorized at bid time and can be ~14 days old at close, and proof is verified days after the race. A single PaymentIntent hold cannot cover that. Recommend: capture at auction close (hold is then at most the bid-to-close span), keep funds in the platform balance, pay the athlete by Transfer after proof, refund otherwise. For holds older than ~6 days before close, HYR-11 must re-authorize (needs saved payment method via SetupIntent/Customer) or request extended authorization where eligible. HYR-1 does not implement this but chooses account/capability settings consistent with it. This changes the literal wording "manual capture" to "manual capture on the bid-time hold, then capture at close"; it needs product confirmation before HYR-11 is designed.
3. What "delayed payout" means. Two layers: (a) delay of the Transfer to the athlete until proof is verified (the real escrow control, HYR-14), (b) payout schedule on the connected account (when Stripe moves the athlete's balance to their bank). Recommend (a) as the control and leave (b) on Stripe's default automatic schedule for Express, to avoid the platform having to trigger every payout. The adapter keeps the schedule in one named constant so switching to `manual` is a one-line change if product wants platform-triggered payouts. Verify the Express manual-schedule behavior against current Stripe docs before choosing it.
4. Gate on payout readiness. Recommend no gate in HYR-1; nudge in UI. Decide in a follow-up whether an athlete must be READY before their entry's auctions open, or only before the proof deadline. An athlete who wins but never onboards leaves held funds with nowhere to go.
5. Onboarding trigger. Recommend athlete-initiated from `/account/payouts` (lazy account creation on first click), not at signup, to avoid creating Stripe accounts for athletes who never sell.
6. Webhooks. Recommend two endpoints/secrets, persisted event log for dedupe, fast 2xx, handlers re-read state. Confirm whether `account.updated` for connected accounts needs the Connect endpoint in current Stripe behavior (plan assumes yes; verify in test mode in slice D/G).
7. Verified email before onboarding (auth spec deferred this to HYR-14). Recommend still defer: Stripe KYC verifies the person who receives money, onboarding is tied to the authenticated athlete, bib verification gates sales. Revisit with email infra.
8. US-only. Recommend hard-code `country: 'US'` in the adapter and USD in later tickets; non-US athletes see Stripe's own country/KYC failure. No country field on `Athlete`.
9. Env required vs optional. Recommend required, fail-closed, with test keys in all non-prod environments, matching storage vars.
10. Where onboarding lives. Resolved: split out to HYR-51 (athlete payout onboarding). Slices F-H (HYR-48..HYR-50) are blocked by the HYR-1 slices; A-E stand alone. Sections 4.6-4.8 are specified here but delivered under HYR-51.
11. Dispute/negative-balance liability on Express sits with the platform. Informational; owned by HYR-14 and the dispute flow.
