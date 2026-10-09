# HYR-30: Web Login/Session Flow (Token Storage, Authenticated API Client) - Design

Status: APPROVED. Decisions D1-D8 (section 8) confirmed by the product owner via the coordinator; D3 amended (confirm-password field). Linear HYR-30 scope comes from the dispatch brief. Follows HYR-3 (backend auth, done) and HYR-27 (floor price, done). Frontend-only: no backend change.

## 1. Context and findings

- Backend auth (`src/auth/auth.controller.ts`) already exposes everything needed: `POST /auth/signup` (201), `POST /auth/login` (200), `POST /auth/refresh` (200), `POST /auth/logout` (204), `GET /auth/me` (JWT). Signup and login return `{ accessToken, refreshToken, expiresIn, athlete: { id, name, email, isAdult } }`; refresh returns `{ accessToken, refreshToken, expiresIn }`. There is no refresh endpoint gap.
- Refresh tokens are opaque, rotating, hashed server-side, with reuse detection: presenting an already-rotated token revokes ALL the athlete's refresh tokens (`rejectReuse`). Consequence: two concurrent refreshes with the same token (two tabs, or two parallel 401s in one tab) log the user out everywhere. Client refresh must be single-flight.
- The backend only reads the refresh token from the JSON body (`RefreshDto`), never from a cookie, and sets no cookies. Access TTL 900 s, refresh TTL 2_592_000 s (30 days), both env-configurable. Sensitive routes are throttled at 10/min (429).
- Error shape: Nest `{ statusCode, message, error }` where `message` is a snake_case code for domain errors (`invalid_credentials` 401, `athlete_banned` 403, `email_already_registered` 400, `adult_attestation_required` 400, `invalid_refresh_token` 401) and the generic `validation_failed` 400 for DTO failures. The existing `errorCode()` in `floor-price-api.ts` already extracts `message`.
- Web today: `web/` (SvelteKit 3.0.1, Svelte 5 runes, adapter-auto, Tailwind, Vitest+jsdom) has no auth. `floor-price-api.ts` takes an injected sync `getAccessToken: () => string | null` and `fetchImpl`. `/dev/body-map` has a throwaway "Access token (dev only)" field. Routes: `/` (a link) and `/dev/body-map`. Env: `import.meta.env.VITE_API_BASE_URL` (SvelteKit 3.0.1 has no `$env/dynamic/public`); backend `CORS_ORIGINS` must include `http://localhost:5173`. `cookie` is pinned to 2.0.1 in web (hoisting gotcha). Prettier for web: `--single-quote --print-width 100`. ESLint does not lint `.svelte` files.

## 2. Goal and non-goals

Goal: an athlete can sign up or log in on the web, stay signed in across reloads and access-token expiry, log out, and every web API call goes through one authenticated fetch client that attaches the token and transparently refreshes. The HYR-27 harness uses the session instead of the pasted token.

Non-goals: password reset, email verification (deferred to HYR-14), staff auth, social login, "remember me" toggle, profile page, final visual design, deploy adapter choice, backend changes, per-device session list.

## 3. Approaches considered (token storage and refresh)

1. **Access token in memory, refresh token in an httpOnly cookie owned by SvelteKit server routes (BFF-lite). Recommended (D1).** Browser calls same-origin `POST /session/{login,signup,refresh,logout}` (SvelteKit `+server.ts`), which forward to the Nest `/auth/*` endpoints and keep the refresh token in an httpOnly, SameSite=Strict cookie the browser JS can never read. The access token is returned in JSON and held only in memory; all other API calls go browser -> Nest directly with `Authorization: Bearer`. Pros: XSS cannot exfiltrate the 30-day credential; no backend change; the Nest API stays stateless-bearer. Cons: needs a server runtime for `web/` (SvelteKit routes, so adapter must not be static; adapter-auto picks one at deploy, still deferred) and a server-side API base URL.
2. Access token in memory, refresh token in `localStorage`. Simplest, fully client-side, works with any static adapter. Cons: any XSS can steal a 30-day rotating credential; the product handles payments (escrow) so this is the wrong default. Acceptable fallback only if D1 is rejected.
3. Both tokens in `localStorage`/`sessionStorage`. Rejected: also exposes the access token and loses nothing in simplicity versus 2.
4. Backend sets the cookie (change `/auth/*` to Set-Cookie, add CSRF handling, CORS credentials). Rejected for this ticket: backend change, cross-site cookie and CSRF surface, and it breaks the documented body-based refresh contract; not needed since option 1 achieves the same property.

Refresh strategy (D2), recommended: bootstrap on app load, proactive-with-reactive hybrid.
- On first client load the session store calls `POST /session/refresh` (cookie sent automatically). Success -> authenticated; 401 -> anonymous. (Memory-only access token means every full reload needs one refresh.)
- Authenticated fetch refreshes proactively when the access token expires within 30 s (`expiresAt - now < 30_000`), and reactively once on a 401 (retry the original request exactly once). A second 401 or a failed refresh clears the session.
- Refresh is single-flight in-tab (one shared promise). Across tabs it is serialised with `navigator.locks.request('hyrox-session-refresh', ...)`. Because the cookie jar is shared by all tabs, a tab that waits on the lock sends the already-rotated cookie, so reuse detection is not tripped. Each tab keeps its own in-memory access token; tabs do not broadcast tokens. Where `navigator.locks` is missing, only in-tab single-flight applies and a simultaneous cross-tab refresh can trip reuse detection (logs out everywhere); accepted residual for MVP (all current evergreen browsers support Web Locks). If manual QA shows flakiness, a backend rotation grace window is a separate ticket.

## 4. Design

### 4.1 Units

All under `web/src/`. Each unit has one job and is tested with injected fakes (no real network).

- `lib/auth/auth-types.ts`: `SessionAthlete { id, name, email, isAdult }`, `SessionTokens { accessToken, expiresIn }`, `AuthApiError(status, code)`.
- `lib/auth/auth-api.ts` (browser -> same-origin BFF): `createAuthApi({ fetchImpl })` with `login(email, password)`, `signup(input)`, `refresh()`, `logout()`. Same-origin relative URLs (`/session/...`), `credentials: 'same-origin'`. Returns `{ accessToken, expiresIn, athlete? }`. Throws `AuthApiError` using the shared error-code extraction.
- `lib/auth/error-code.ts`: the `errorCode(response)` helper extracted from `floor-price-api.ts` so both clients share it (the floor-price copy is removed).
- `lib/auth/session.svelte.ts`: rune-based store (`$state`): `status: 'loading' | 'authenticated' | 'anonymous'`, `athlete`, `accessToken` (private), `expiresAt`. Methods: `bootstrap()` (idempotent), `login`, `signup`, `logout`, `refresh()` (single-flight + Web Lock), `getAccessToken()`. Created via `createSession({ authApi, now, locks })` for tests; one module-level instance exported for the app. Tokens never touch `localStorage`, `sessionStorage`, or any cookie readable by JS.
- `lib/auth/authed-fetch.ts`: `createAuthedFetch({ session, fetchImpl })` returns a function with the `fetch` signature. Behaviour in 3, above. Throws `NotAuthenticatedError` when there is no session and no refresh possible. Request bodies in this app are strings, so a retry can reuse `init` safely (documented restriction: no stream bodies).
- `lib/auth/safe-next.ts`: `safeNext(raw): string` returns `raw` only if it starts with a single `/` (not `//`, no scheme, no backslash), else `/`. Prevents open redirect after login.
- `lib/auth/auth-errors.ts`: code -> user message table (`invalid_credentials`, `athlete_banned`, `email_already_registered`, `adult_attestation_required`, `validation_failed`, 429, `request_failed`, `not_authenticated`).
- `lib/auth/validation.ts`: pure client-side checks mirroring the DTOs (email shape, password length 10-128 on signup, name 1-100 trimmed, attestation true) plus signup-only confirm-password equality (client-only). Server remains authoritative.
- Components: `lib/auth/LoginForm.svelte`, `lib/auth/SignupForm.svelte`, `lib/auth/AuthGate.svelte` (loading -> status text; anonymous -> `goto('/login?next=...')`; authenticated -> children), `lib/auth/LogoutButton.svelte`.
- Routes: `routes/login/+page.svelte`, `routes/signup/+page.svelte` (both redirect to `safeNext(next)` when already authenticated); `routes/+layout.svelte` calls `session.bootstrap()` on mount (client only, `onMount`); `routes/+page.svelte` shows login/signup or logout based on status.
- Server (BFF-lite): `routes/session/login/+server.ts`, `signup/+server.ts`, `refresh/+server.ts`, `logout/+server.ts`, plus `lib/server/backend-auth.ts` (calls `${API_BASE}/auth/*` with injected `fetch`, returns normalised results) and `lib/server/refresh-cookie.ts` (set/read/clear helpers). Thin `+server.ts` files only wire `request`, `cookies`, `fetch`.

### 4.2 BFF contract (browser <-> SvelteKit)

| Route | Body | Success | Failure |
|---|---|---|---|
| `POST /session/login` | `{ email, password }` | 200 `{ accessToken, expiresIn, athlete }` + Set-Cookie | backend status and `{ message: code }` passed through |
| `POST /session/signup` | `{ name, email, password, adultAttested }` | 201 `{ accessToken, expiresIn, athlete }` + Set-Cookie | pass-through |
| `POST /session/refresh` | none (cookie) | 200 `{ accessToken, expiresIn }` + rotated Set-Cookie | no cookie -> 401 `invalid_refresh_token`; backend 401 -> 401 and the cookie is cleared |
| `POST /session/logout` | none (cookie) | 204, cookie cleared; calls `/auth/logout` best effort | always 204 (idempotent, never leaks backend errors) |

The refresh token is NEVER present in any JSON response to the browser. Cookie: name `hyrox_refresh`, `httpOnly`, `sameSite: 'strict'`, `secure` unless dev (`dev` from `$app/environment`), `path: '/session'` (only sent to the BFF), `maxAge` from `REFRESH_COOKIE_MAX_AGE_SECONDS` defaulting to `2_592_000` to match the backend default. After a refresh the cookie is re-set (rotation). On any backend 401 from `/auth/refresh` the cookie is cleared so a revoked token is not retried.

`/auth/me` is not needed on bootstrap because login/signup/refresh responses are enough: refresh returns no athlete, so bootstrap then calls `GET /auth/me` once through the authed fetch to populate `athlete` (only used for display; failure is non-fatal and leaves `athlete: null`).

### 4.3 Data flow

1. Page load -> layout `onMount` -> `session.bootstrap()` -> `POST /session/refresh`. 200 -> store token + `expiresAt = now + expiresIn*1000`, fetch `/auth/me`, status authenticated. 401 -> anonymous.
2. Login/signup form submit -> client validation -> `session.login/signup` -> BFF -> status authenticated -> `goto(safeNext(next))`.
3. API call (e.g. floor prices) -> `authedFetch` -> proactive refresh if near expiry -> request with Bearer -> 401 -> single refresh -> retry once -> else session cleared (AuthGate then redirects to `/login?next=`).
4. Logout -> `POST /session/logout` -> session cleared locally even if the call fails -> `goto('/')`.

### 4.4 Error handling and UX

- Forms show one inline error region (`role="alert"`), field-level hints for client-side validation, disabled submit while pending, no double submit. Login never distinguishes unknown email from wrong password (backend already returns `invalid_credentials` for both). Banned -> "This account is suspended." Duplicate email shows the backend code's message (accepted tradeoff from HYR-3). 429 -> "Too many attempts. Wait a minute and try again."
- Network error (fetch rejects) -> `request_failed` message; during bootstrap, a network error leaves status anonymous but does not clear the cookie.
- Accessibility: labels bound to inputs, `autocomplete` (`email`, `current-password`, `new-password`, `name`), `type=password`, focus rings consistent with the existing harness classes, error `role="alert"`.

### 4.5 HYR-27 integration

- `floor-price-api.ts`: drop `getAccessToken` and its `not_authenticated` pre-check; it now relies on an injected authed `fetchImpl` (same file keeps `FloorPriceApiError`). Spec updated accordingly. `ZoneFloorPricePanel`/state untouched unless they key off the removed `not_authenticated` code (verify in task F7).
- `/dev/body-map/+page.svelte`: remove the token field and the "Load prices" button's token dependency; wrap in `AuthGate`; build the api with `fetchImpl: authedFetch`; load prices automatically when authenticated; add `LogoutButton`.

### 4.6 Config

`web/.env.example` adds `REFRESH_COOKIE_MAX_AGE_SECONDS=2592000` (server-side). The BFF reuses `VITE_API_BASE_URL` for the backend URL (no `$env/dynamic/*` available on this SvelteKit version; verify in task F2 whether `$env/dynamic/private` exists on 3.0.1 and prefer a non-`VITE_` `API_BASE_URL` if it does). Backend `CORS_ORIGINS` must still include the web origin because the browser calls Nest directly for resource requests (Authorization header triggers preflight; already configured). No backend env change.

### 4.7 Security notes

- XSS: access token lives in a closure/rune state only (15 min lifetime); refresh credential unreachable from JS.
- CSRF: refresh/logout BFF routes are cookie-authenticated but `SameSite=Strict`, `path=/session`, POST-only, JSON, and SvelteKit's origin check applies; the response of `/session/refresh` is a bearer token the attacker's origin cannot read (no CORS on BFF routes). Residual: forced logout via cross-site POST is blocked by Strict.
- Open redirect: `safeNext`.
- Token never logged; no tokens in URLs.
- `trust proxy` / throttling keyed on proxy IP: when the BFF calls Nest server-side, ALL users appear to come from the web server's IP, so the 10/min throttle on `/auth/login|signup|refresh` becomes effectively global per web host. This is a real consequence of option 1. Mitigations to decide in D6: forward `X-Forwarded-For` and set `trust proxy` in Nest (small backend change, separate ticket) or accept for MVP traffic.

## 5. Testing

Vitest, nested `describe` per condition ("when ..."), short `it` titles, shared setup in `beforeEach`.
- Server helpers and route handlers: fake `fetch` and fake `cookies` (get/set/delete recorders); assert the refresh token is never in the response body, cookie flags, rotation, clear-on-401, logout idempotence.
- `auth-api`, `error-code`: fake `fetch`.
- `session` store: fake `authApi`, fake clock, fake `locks`; bootstrap success/401/network error, single-flight (N concurrent refresh calls -> one API call), lock fallback when `navigator.locks` is absent, logout clears state even when the call rejects.
- `authed-fetch`: no session; proactive refresh; 401 -> refresh -> retry once; second 401 -> session cleared and error; refresh failure; Authorization header; does not double-retry non-401.
- `safe-next`, `validation`, `auth-errors`: table tests.
- Components (testing-library): login/signup forms (validation, pending state, server error mapping, redirect via injected `goto`), AuthGate states. Dev harness page smoke test only if cheap.
- Gate: `npm test -w web`, `npm run check -w web`, `npm run build -w web`. Manual e2e against dev backend in the final task.

## 6. Out of scope follow-ups to record

- Backend rotation grace window or `trust proxy` + `X-Forwarded-For` forwarding.
- Deploy adapter selection (BFF needs a server runtime).
- Email verification (HYR-14), password reset.

## 7. Backend / frontend split

Frontend-only. No backend task. Within the frontend, the BFF server routes and the browser-side session/authed-fetch units are separate files but ship together; they are sequential in one track.

## 8. Open decisions (recommendation first)

- **D1 Token storage. APPROVED (option A).** Recommend: access token in memory + refresh token in httpOnly SameSite=Strict cookie via SvelteKit BFF routes. Alternative: refresh token in `localStorage` (simpler, static-adapter friendly, XSS-exposed).
- **D2 Refresh strategy. APPROVED.** Recommend: bootstrap refresh on load, proactive refresh 30 s before expiry, one reactive retry on 401, in-tab single-flight plus `navigator.locks` across tabs. Residual cross-tab race accepted for MVP.
- **D3 Signup fields. APPROVED, CHANGED.** name, email, password (min 10, max 128, matching `SignupDto`), confirm-password, required 18+ checkbox (`adultAttested: true`; backend rejects otherwise). Confirm-password is validated client-side only (must equal password, error key `confirmPassword`) and is never sent to the BFF or backend. Show/hide password toggle not built.
- **D4 Post-auth redirect. APPROVED.** Recommend: `?next=` validated by `safeNext`, default `/`.
- **D5 Route protection. APPROVED.** Client-side `AuthGate` only (SSR cannot know the session because the access token is memory-only); real enforcement is the backend JWT guard. No SSR page rendering is needed: the web server exists only for the cookie-setting `/session/*` endpoints. The deploy adapter must therefore be a server adapter, not a static one.
- **D6 Throttle consequence of BFF. APPROVED.** Accepted for MVP; the follow-up backend ticket (`trust proxy` + `X-Forwarded-For` forwarding) is being filed separately in Linear.
- **D7 HYR-27 refactor. APPROVED.**  remove `getAccessToken` from `floor-price-api` in favour of the injected authed `fetchImpl` (one place attaches the token).
- **D8 Logout scope. APPROVED.**  log out this device only (revoke the one refresh token via `/auth/logout`), no "log out everywhere".
