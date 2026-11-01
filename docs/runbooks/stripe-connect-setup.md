# Stripe Connect setup runbook (HYR-1)

Spec: `docs/specs/2026-10-31-hyr-1-stripe-connect-setup-design.md` (section 4.9). Plan: `docs/plans/2026-10-31-hyr-1-stripe-connect-setup.md`.

Confirmed product decisions this setup follows: Express connected accounts, US only, separate charges and transfers, default payout schedule, athlete-initiated onboarding, two webhook endpoints.

Verification legend: **[verified]** checked against Stripe docs on 2026-10-31 (docs.stripe.com/connect/express-accounts, docs.stripe.com/connect/webhooks). **[unverified]** not confirmed against current docs or the live dashboard; check before relying on it. Dashboard labels move often; treat menu names as hints.

Do everything below in a Stripe **sandbox / test mode** first. Repeat for live mode only after the live-mode review note at the end.

## 1. Enable Connect and set the platform profile

1. Dashboard > Connect > Get started, choose a US platform. [unverified: exact menu path]
2. Complete the platform profile at `dashboard.stripe.com/connect/registration`. [verified: Express requires a platform profile]
3. Fraud: the platform is liable for Express connected-account losses; review Stripe's Connect risk-management guidance before going live. [verified]

## 2. Express accounts and onboarding branding

1. Connect settings (`dashboard.stripe.com/account/applications/settings`): set brand name, color and icon. Connect Onboarding requires them. [verified]
2. Express accounts are created by the API with `type: 'express'`. Stripe now labels Standard/Express/Custom as legacy and steers new platforms to controller properties / Accounts v2. The spec chose Express; revisit only if account creation is rejected or Stripe retires it for new platforms. [verified: deprecation notice on the Express page]
3. Leave the default payout schedule (no override). [decision confirmed; schedule behavior for Express unverified]
4. Do not enable cross-border user registration; US only. [verified: per-country registration lives in Connect settings]

## 3. API keys

| Mode | Where | Used by |
|---|---|---|
| Test / sandbox | Developers > API keys (test) | local, CI-less manual testing, non-prod environments |
| Live | Developers > API keys (live) | production only |

- Set `STRIPE_SECRET_KEY` to a `sk_test_...` or `sk_live_...` secret key (a restricted `rk_...` key is also accepted). Never commit it; never reuse a live key outside production.
- Webhook endpoints, their secrets and keys are separate per mode and per sandbox. [verified: separate endpoints needed per sandbox]

## 4. Webhook endpoints (two, each with its own secret)

Create both in Workbench > Webhooks (`dashboard.stripe.com/workbench/webhooks`), in each mode. The scope is the "Events from" setting. [verified]

| Endpoint | URL | Events from | Events (initial) | Env var for secret |
|---|---|---|---|---|
| Platform | `https://<api-host>/stripe/webhooks/platform` | Your account | none required yet (HYR-11/14 add PaymentIntent events) | `STRIPE_PLATFORM_WEBHOOK_SECRET` |
| Connect | `https://<api-host>/stripe/webhooks/connect` | Connected accounts | `account.updated` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

- `account.updated` for connected accounts is delivered to the "Connected accounts" scope. [verified]
- Each endpoint has its own `whsec_...` signing secret (reveal it on the endpoint page). The two values must differ or the app refuses to boot. [signing-secret location unverified]
- Webhook URLs must be HTTPS and publicly reachable. Routes ship in slice D (HYR-46); create the endpoints once that is deployed, or earlier with placeholder URLs and update later.

## 5. Onboarding return and refresh URLs

- `STRIPE_CONNECT_RETURN_URL`: where the athlete lands after onboarding, planned as `<web-origin>/account/payouts?return=1`.
- `STRIPE_CONNECT_REFRESH_URL`: used when the link expired or was already used, planned as `<web-origin>/account/payouts?refresh=1`.
- HTTP is accepted in test mode (localhost ok), live mode requires HTTPS. [verified]
- Both pages ship with the athlete payout onboarding work (HYR-51); until then the URLs only need to be valid.

## 6. Environment variables (five, all required, fail-closed)

Set all five in **every** environment before the slice B PR (HYR-44) merges, or the app will not boot (`env_invalid`).

| Var | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` / `sk_live_...` (or `rk_...`) |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | `whsec_...` from the Platform endpoint |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_...` from the Connect endpoint (different from the platform one) |
| `STRIPE_CONNECT_RETURN_URL` | URL, see section 5 |
| `STRIPE_CONNECT_REFRESH_URL` | URL, see section 5 |

## 7. Local development with the Stripe CLI

```
stripe login
stripe listen --forward-to localhost:3000/stripe/webhooks/platform
stripe listen --forward-connect-to localhost:3000/stripe/webhooks/connect
```

(`3000` is the default `PORT`.) Run each in its own terminal. [verified: flags `--forward-to` for your account, `--forward-connect-to` for connected accounts]

Trigger test events:

```
stripe trigger account.updated --stripe-account <acct_...>
```

Caveat [unverified]: `stripe listen` prints a `whsec_...` for the session, and both sessions may print the same secret. The app requires the two secrets to differ, so for local use set the second to any other valid-looking `whsec_...` value only if you are not exercising that channel, or run one channel at a time. Confirm the behavior when slice D is built and update this section.

## 8. Live-mode review note

Live-mode Connect needs Stripe to approve the platform before real athletes can be onboarded. [unverified: exact review requirements and timing] Do not promise a launch date from code completion. Switching to live means: live keys, live webhook endpoints and secrets, HTTPS return/refresh URLs, completed platform profile.

## 9. Pre-merge checklist

- [ ] Test-mode Connect enabled, platform profile and branding set.
- [ ] Both webhook endpoints created in test mode, secrets copied.
- [ ] Five env vars set in every non-production environment, and in production, before HYR-44 merges.
- [ ] Live-mode review started (does not block code merges).
