# HYR-31: Forward client IP through the web BFF so the auth throttle is per user

## 1. Problem

HYR-30 proxies `/auth/*` through SvelteKit `/session/*` routes. Nest's `ThrottlerGuard` keys on `req.ip`. Server-side calls from the BFF all arrive from the web host, so `login`, `signup` and `refresh` (10/min via `SENSITIVE_ROUTE_LIMIT` in `src/auth/auth.controller.ts`) share one bucket across every user. One noisy client, or an attacker, locks everyone out, and per-IP brute-force protection is effectively gone.

## 2. Goal and scope

In scope:
- Nest trusts a configured number of proxy hops, so `req.ip` (and the throttler key) comes from `X-Forwarded-For` (XFF).
- Each `/session/*` handler forwards the real client IP to Nest in XFF.
- Tests prove the throttle is per client IP, not per web server, and cannot be dodged by a spoofed leftmost XFF entry.
- Document prod config implications for HYR-32.

Out of scope: changing limits, a distributed throttler store (in-memory per API instance stays), a shared-secret header between BFF and API (see 6), the pre-deploy checklist itself (HYR-32), `GET /auth/me` or other non-auth routes (they are called by the browser directly, so they already see the real IP).

## 3. Design

### 3.1 Nest: `TRUST_PROXY_HOPS`

- New env var `TRUST_PROXY_HOPS`: integer 0..10, default `0`, validated at boot in `src/config/env.validation.ts` like `PORT`.
- `0` means trust nothing (today's behavior, Express `trust proxy` = `false`). `n >= 1` sets Express `trust proxy` to the number `n`.
- Applied in `main.ts` through a small helper `applyTrustProxy` in `src/common/trust-proxy.ts` (typed against `NestExpressApplication`), so it is unit-testable without booting `main.ts`.
- Number, not boolean: `true` makes Express trust the entire XFF chain and take the leftmost entry, which any caller can forge. A hop count makes Express skip exactly `n` entries from the right, so entries the client prepends are never used.
- Default is 0 (safe by default): an environment that forgets to configure it behaves as before, and cannot become spoofable by accident. Local dev sets `1` in `.env.example`.

Semantics: with `n` trusted hops, `req.ip` is the address `n` positions from the right in the list `[...XFF entries, socket peer]`. Meaning, hops = number of infrastructure proxies that sit between the client IP the BFF resolved and Nest, counting the BFF itself.
- BFF connects straight to Nest: `n = 1`. XFF is `<clientIp>`; the socket peer is the BFF and is skipped.
- BFF -> internal load balancer (which appends the BFF's address) -> Nest: `n = 2`.

### 3.2 SvelteKit: forward in the BFF

- A new server helper `web/src/lib/server/client-ip.ts` exports `resolveClientIp(getClientAddress: () => string): string | null`. It calls the function and returns the string, or `null` if it throws or returns an empty string (SvelteKit's `getClientAddress` throws when the adapter cannot determine the address, e.g. some dev/prerender cases).
- The four `+server.ts` routes pass `resolveClientIp(getClientAddress)` into the handlers. Handlers pass it to `BackendAuth`, whose `post` helper sets `X-Forwarded-For` to exactly that value when non-null, and omits the header when null.
- Overwrite, never append, and never forward the inbound browser XFF. The BFF is the trust boundary: `getClientAddress()` already applies the web deployment's own proxy settings (adapter-node `ADDRESS_HEADER` / `XFF_DEPTH`, or the platform adapter's equivalent), so its answer is the single authoritative client IP. Forwarding the browser's raw XFF would let a caller inject entries. The outgoing XFF therefore has one entry.
- Fail-soft: if the IP is unknown, send no XFF. Nest then keys on the BFF's socket address (today's behavior). Auth must not fail because an IP could not be resolved.
- Applies to login, signup, refresh and logout for consistency (logout falls under the global 60/min limit).

### 3.3 Data flow

browser -> (edge proxies, web host config) -> SvelteKit `/session/login` -> `getClientAddress()` = C -> `POST {API}/auth/login` with `X-Forwarded-For: C` -> (optional internal proxies append) -> Express with `trust proxy = n` -> `req.ip = C` -> `ThrottlerGuard` key.

## 4. Error handling

No new error codes. Invalid `TRUST_PROXY_HOPS` makes boot fail with the existing `env_invalid` path. Missing or unresolvable client IP degrades silently to the shared-bucket behavior (the pre-HYR-31 status quo).

## 5. Testing

Backend (Vitest, `src/**/*.spec.ts`, no new deps; `@nestjs/testing` and global `fetch` against an ephemeral port, no supertest):
- Env validation: default 0, accepts 0..10, rejects negative, > 10, non-integer.
- `applyTrustProxy`: 0 -> Express setting `false`; n -> number `n`.
- Throttle integration: a throwaway controller with a low `@Throttle` limit (for example 2/min) under the real `ThrottlerGuard`, app configured through `applyTrustProxy`:
  - hops=1: two XFF values each get their own full bucket; the same value gets 429 on the third call.
  - hops=1: rotating a forged leftmost entry (`forged-N, real`) does not evade the limit (keyed on `real`).
  - hops=0: XFF is ignored, all callers share the socket bucket (documents the default).

Web (Vitest):
- `resolveClientIp`: returns the address; returns null on throw; null on empty string.
- `backend-auth`: sets `X-Forwarded-For` to the given IP on all four calls; omits it when null; never forwards other inbound headers.
- `session-handlers`: each handler passes the received client IP to the backend.

Manual (plan final task): start API with `TRUST_PROXY_HOPS=1`, hit `/session/login` wrongly 11 times from the web app, confirm 429 only for that client; a second client IP (via `curl -H` against the API directly in dev) is unaffected.

## 6. Production implications (note for HYR-32)

1. Spoofing risk if the API is directly reachable. Today the browser calls the API directly for non-auth routes (floor price etc. via `VITE_API_BASE_URL`), so the API is publicly reachable. With `TRUST_PROXY_HOPS=1` and no proxy in front of Nest, any caller who hits `/auth/login` directly can send `X-Forwarded-For: <random>` and get a fresh bucket per request, defeating the brute-force limit (worse than today for direct callers). One hop count cannot be correct for both the BFF path and a direct-to-API path through the same ingress, because the BFF path has one more trusted entry. HYR-32 must pick one:
   - (a) Recommended for now: block public access to `/auth/*` at the ingress (or expose the API only on a private network to the web host plus a public ingress that does not route `/auth/*`), so only the BFF can reach those routes; then `TRUST_PROXY_HOPS` reflects exactly the BFF path.
   - (b) Follow-up ticket: a shared-secret header (`X-BFF-Auth`, constant-time compared) that makes Nest honor a BFF-supplied client IP only when authenticated. Topology independent, but new code and secret management; deliberately not in HYR-31.
2. Hop count must equal the real topology. Too high: Express skips real client entries and keys on an attacker-controlled or internal address. Too low: keys on a proxy address (shared bucket again). Set per environment, test after any infra change (adding a CDN or LB changes the count).
3. Web side: the BFF's `getClientAddress()` is only correct if the web deployment is configured for its own proxies. `adapter-auto` resolves to a platform adapter at build time; if that is adapter-node, set `ADDRESS_HEADER` (for example `X-Forwarded-For`) and `XFF_DEPTH` to match the web ingress. Otherwise `getClientAddress()` returns the ingress IP and the shared bucket returns. Add to the checklist: verify with two real clients.
4. Throttler storage is in-memory per API instance. With N API replicas the effective limit is up to N times 10/min per IP. Acceptable now; a Redis store is a separate decision.
5. IPv6 and IPv4-mapped (`::ffff:1.2.3.4`) forms are used verbatim as keys; not normalized. Acceptable; revisit if abuse shows up.
6. Add `TRUST_PROXY_HOPS` to the prod env list; the README documents it.

## 7. Decisions made without sign-off (reviewable)

- D1 Hop count over boolean; default 0; range 0..10.
- D2 BFF overwrites XFF with a single `getClientAddress()` value; never appends or forwards the browser's header.
- D3 Fail-soft when the IP cannot be resolved.
- D4 Apply to all four `/session/*` handlers, not only the throttled three.
- D5 No shared-secret header in HYR-31; ship hop-count and flag ingress restriction to HYR-32 (6.1).
- D6 `req.ip` only; no custom throttler `getTracker`, since Express already derives it once `trust proxy` is set.
