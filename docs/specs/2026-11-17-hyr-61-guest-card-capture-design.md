# HYR-61: Guest card capture step (web) - Design Spec

Status: APPROVED (chat, 2026-11-17). Linear: HYR-61 (branch `hyr-61`).
Depends on: HYR-59 (`POST /bidders/setup-intents`). Related: HYR-60 (webhook fills card columns), HYR-11 (card gate + token enforcement on bids), HYR-62 (token reissue).

## 1. Context

- Backend: `POST /bidders/setup-intents`, body `{ email }`, optional header `X-Bidder-Token`, returns `201 { clientSecret, bidderToken, bidderTokenExpiresAt }`, `Cache-Control: no-store`. 401 `bidder_token_required` when the email already has a saved card and the token is missing, expired or for another bidder. 400 `email_invalid`, 409 `bidder_stripe_customer_conflict`, 429 throttled (10/min/IP). Never returns card brand/last4.
- Web has no auction or bid page. API clients follow `lib/connect/connect-api.ts` (`sendJson`, `ApiResult`, base URL from `VITE_API_BASE_URL`). Components take injected deps as props (`PayoutsPanel`). Dev harness routes live under `routes/dev`.
- `@stripe/stripe-js` is not installed.

## 2. Scope

In: Stripe Elements card form wired to the setup endpoint, bidder token store (memory + sessionStorage), UI states (loading, saved with brand/last4, declined, error, `bidder_token_required`, retry), publishable key via env, a `/dev/card` harness route.

Out: "card required to bid" gate and token enforcement on bids (HYR-11), token reissue (HYR-62), any auction page, polling the backend for the synced card.

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Standalone `GuestCardCapture` component, mounted only on `/dev/card`. | No bid flow exists; real page imports it later (HYR-11 or UI ticket). |
| D2 | Browser calls the API directly (no BFF). | Endpoint is public, CORS reflects requested headers, throttle sees the real client IP. |
| D3 | Token sent only as `X-Bidder-Token`, never `Authorization`. | Cannot collide with the athlete session. |
| D4 | Token store: memory first, mirrored to `sessionStorage`, dropped when `expiresAt` has passed. A fresh token replaces the old one on every successful setup call. | Matches the backend's sliding TTL; survives reload within the tab. |
| D5 | Saved brand/last4 come from Stripe's `createPaymentMethod` result (`paymentMethod.card`), then `confirmCardSetup(clientSecret, { payment_method: id })` confirms it. Not from the API. | The setup endpoint never returns them, and `confirmCardSetup` only returns the payment method id, not card details. |
| D6 | `bidder_token_required` is a terminal state with an explanatory message and no retry button. | Retrying cannot succeed until HYR-62. Email can be changed to start over. |
| D7 | Stripe loading is behind an injectable `StripeLoader`; publishable key from `VITE_STRIPE_PUBLISHABLE_KEY`. Missing key puts the component in a clear config-error state. | Testable with a fake; no real Stripe in tests. |
| D8 | `@stripe/stripe-js` pinned to an exact version. | Repo dependency rule. |

## 4. Design

Files under `web/src/lib/bidder/`:

- `bidder-api.ts`: `createBidderApi(baseUrl, fetch)` returning `createSetupIntent(email, token?)`: `Promise<ApiResult<SetupIntentResponse>>`; adds `X-Bidder-Token` when a token is given.
- `bidder-token-store.ts`: `createBidderTokenStore(storage, now)` with `get()`, `set(token, expiresAt)`, `clear()`. Tolerates a missing or throwing `sessionStorage` (falls back to memory).
- `bidder-errors.ts`: maps error codes (`email_invalid`, `bidder_token_required`, `bidder_stripe_customer_conflict`, 429, network) to messages.
- `stripe-loader.ts`: `StripeLoader` type and `createStripeLoader(publishableKey)` wrapping `loadStripe`.
- `GuestCardCapture.svelte`: props `api`, `stripeLoader`, `tokenStore`. States: `idle` (email entry), `loading`, `ready` (card Element mounted), `confirming`, `saved` (brand, last4), `declined` (Stripe card error, retry), `error` (retryable), `token_required` (terminal), `unconfigured` (no key). Flow: email submit -> `createSetupIntent` -> store token -> mount Element -> `confirmCardSetup(clientSecret)` -> `saved` or `declined`. Retry creates a fresh setup intent (backend is not idempotent by design).
- `routes/dev/card/+page.svelte`: wires real api, loader, store.
- `web/.env.example`: `VITE_STRIPE_PUBLISHABLE_KEY`. README section.

## 5. Testing

Vitest + Testing Library, fake Stripe and fake api: api client (header, error mapping), token store (expiry, storage failure), error messages, component per state (including terminal `token_required` and declined retry). No real Stripe call.
