# HYR-30: Web Login/Session Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Athletes sign up, log in, stay signed in across reloads and token expiry, and log out on the web; all web API calls go through one authenticated fetch client; the HYR-27 harness drops its pasted-token field.

**Architecture:** Access token held in memory only. Refresh token lives in an httpOnly SameSite=Strict cookie owned by SvelteKit `+server.ts` routes (`/session/*`) that proxy the existing Nest `/auth/*` endpoints. A rune-based session store does single-flight refresh (plus `navigator.locks` across tabs). `createAuthedFetch` attaches the bearer token, refreshes proactively and once reactively on 401.

**Tech Stack:** SvelteKit 3.0.1, Svelte 5 runes, TypeScript, Vitest + jsdom + testing-library, Tailwind. No new dependencies.

**Spec:** `docs/specs/2026-10-08-web-login-session-design.md` (read sections 3, 4 and 8 first). Decisions D1-D8 in spec section 8 are APPROVED (D3 amended with a confirm-password field). Deploy adapter must be a server adapter (BFF routes need a runtime); no SSR page rendering is needed.

## Global Constraints

- Frontend only. No backend change, no Prisma change. Backend contract (verified in `src/auth/auth.controller.ts`): `POST /auth/signup` 201, `POST /auth/login` 200, `POST /auth/refresh` 200 body `{refreshToken}`, `POST /auth/logout` 204 body `{refreshToken}`, `GET /auth/me` JWT. Login/signup return `{accessToken, refreshToken, expiresIn, athlete:{id,name,email,isAdult}}`; refresh returns `{accessToken, refreshToken, expiresIn}`. Error body `{statusCode, message, error}` with snake_case `message` for domain errors.
- Signup DTO limits: name 1-100 (trimmed), email valid, password 10-128, `adultAttested` must be `true` (else 400 `adult_attestation_required`). The web signup form also has a confirm-password field, validated client-side only and never sent to the BFF or backend. Login password 1-128.
- Style (CLAUDE.md): exact-pinned deps (none expected), explicit return types on every function, no single-letter names (except `i/j/k` in indexed loops), no inline `if` (brace, body on its own line), blank line before `if/for/while/return/throw` unless first in block, no `!!x`, no nested function declarations, numeric separators on literals of 5+ digits (`2_592_000`, `30_000` stays `30_000`; `900` plain), no barrel files (import specific files with `.ts` extension as existing web code does), `readonly` constructor params, snake_case error codes, comments only for a non-obvious why. Delete dead code.
- Tests: Vitest, nested `describe` per condition ("when ..."), short `it` titles stating only the outcome, shared setup in that `describe`'s `beforeEach`. No real network; inject `fetchImpl`, clock and locks.
- Tokens never go to `localStorage`, `sessionStorage`, URLs, logs, or any JS-readable cookie. The refresh token never appears in a BFF JSON response.
- Gate after each task: `npm test -w web`, `npm run check -w web`. At the end also `npm run build -w web`. Prettier for web: `--single-quote --print-width 100`. ESLint does not lint `.svelte`.
- Git: stage each task's files with `git add`, do NOT commit; user reviews with `/crit`. Conventional Commits (`feat(web): ...`) for the later commit, ending with the Co-Authored-By line from the session. Branch is already `hyr-30`; never rename after a PR exists. Move Linear HYR-30 to In Progress at build start (check state first), In Review only when staged.
- Do not touch `BodyMap.svelte`, `shared/`, or `src/` (backend).

## Track layout

Single frontend track F1-F9, sequential (each unit consumes the previous). Backend track: none. Integration: F9 manual e2e against the dev backend (`docker-compose` postgres on 5435, `npm run start:dev` or equivalent, `CORS_ORIGINS` includes `http://localhost:5173`).

## File structure

Create under `web/src/lib/auth/`: `auth-types.ts`, `error-code.ts`, `auth-api.ts`, `session.svelte.ts`, `authed-fetch.ts`, `safe-next.ts`, `auth-errors.ts`, `validation.ts`, `LoginForm.svelte`, `SignupForm.svelte`, `AuthGate.svelte`, `LogoutButton.svelte` (+ `*.spec.ts` for each non-component unit and forms/gate).
Create under `web/src/lib/server/`: `refresh-cookie.ts`, `backend-auth.ts` (+ specs).
Create routes: `web/src/routes/session/{login,signup,refresh,logout}/+server.ts`, `web/src/routes/login/+page.svelte`, `web/src/routes/signup/+page.svelte`.
Modify: `web/src/routes/+layout.svelte`, `web/src/routes/+page.svelte`, `web/src/routes/dev/body-map/+page.svelte`, `web/src/lib/floor-price/floor-price-api.ts` and its spec, `web/.env.example`, `README.md` (web auth section).

---

### Task F1: Shared auth types and error-code extraction

**Files:**
- Create: `web/src/lib/auth/auth-types.ts`, `web/src/lib/auth/error-code.ts`, `web/src/lib/auth/error-code.spec.ts`
- Modify: `web/src/lib/floor-price/floor-price-api.ts` (import `errorCode` instead of the local copy)

**Interfaces:**
- Produces: `interface SessionAthlete { id: string; name: string; email: string; isAdult: boolean }`; `interface AccessGrant { accessToken: string; expiresIn: number }`; `interface AuthGrant extends AccessGrant { athlete: SessionAthlete }`; `interface SignupInput { name: string; email: string; password: string; adultAttested: boolean }` (no confirm-password); `class AuthApiError extends Error { constructor(readonly status: number, readonly code: string) }`; `class NotAuthenticatedError extends Error` (code `not_authenticated`); `errorCode(response: Response): Promise<string>` returning the body `message` string or `'request_failed'`.

- [ ] **Step 1: Write failing test** `error-code.spec.ts`

```ts
import { errorCode } from './error-code.ts';

describe('errorCode', () => {
  describe('when the body message is a string', () => {
    it('returns the message', async () => {
      const response = new Response(JSON.stringify({ message: 'invalid_credentials' }), { status: 401 });

      await expect(errorCode(response)).resolves.toBe('invalid_credentials');
    });
  });

  describe('when the body is not json', () => {
    it('returns request_failed', async () => {
      await expect(errorCode(new Response('oops', { status: 500 }))).resolves.toBe('request_failed');
    });
  });

  describe('when the message is not a string', () => {
    it('returns request_failed', async () => {
      const response = new Response(JSON.stringify({ message: ['a', 'b'] }), { status: 400 });

      await expect(errorCode(response)).resolves.toBe('request_failed');
    });
  });
});
```

- [ ] **Step 2:** Run `npm test -w web -- error-code` -> FAIL (module missing).
- [ ] **Step 3: Implement.** Move the body of `errorCode` and `GENERIC_CODE` from `floor-price-api.ts` verbatim into `error-code.ts` (export `errorCode`), add `auth-types.ts` with the interfaces/classes above (`NotAuthenticatedError` sets `name` and `message = 'not_authenticated'`). In `floor-price-api.ts` delete the local copy and `import { errorCode } from '../auth/error-code.ts'`.
- [ ] **Step 4:** `npm test -w web` -> PASS (floor-price specs still green); `npm run check -w web`.
- [ ] **Step 5:** `git add web/src/lib/auth web/src/lib/floor-price/floor-price-api.ts`

---

### Task F2: Server-side refresh-cookie helper and backend-auth adapter

**Files:**
- Create: `web/src/lib/server/refresh-cookie.ts`, `web/src/lib/server/refresh-cookie.spec.ts`, `web/src/lib/server/backend-auth.ts`, `web/src/lib/server/backend-auth.spec.ts`

**Interfaces:**
- Consumes: `errorCode` from F1.
- Produces:
  - `REFRESH_COOKIE_NAME = 'hyrox_refresh'`; `interface CookieJar { get(name: string): string | undefined; set(name: string, value: string, options: CookieOptions): void; delete(name: string, options: { path: string }): void }` (structurally compatible with SvelteKit `Cookies`; define `CookieOptions { path: string; httpOnly: boolean; sameSite: 'strict'; secure: boolean; maxAge: number }`).
  - `readRefreshToken(jar): string | null`; `writeRefreshToken(jar, token: string, config: { secure: boolean; maxAgeSeconds: number }): void`; `clearRefreshToken(jar): void`. Cookie path is `/session`.
  - `interface BackendAuthResult<T> { ok: true; value: T } | { ok: false; status: number; code: string }`.
  - `createBackendAuth({ baseUrl, fetchImpl }): { login(email, password): Promise<BackendAuthResult<BackendAuthPayload>>; signup(input: {name,email,password,adultAttested}): Promise<...>; refresh(refreshToken): Promise<BackendAuthResult<BackendTokenPayload>>; logout(refreshToken): Promise<void> }` where `BackendTokenPayload = { accessToken, refreshToken, expiresIn }` and `BackendAuthPayload = BackendTokenPayload & { athlete: SessionAthlete }`. `logout` swallows every error.
- First, in this task, check whether SvelteKit 3.0.1 exposes `$env/dynamic/private` (look in `web/node_modules/@sveltejs/kit` types). If yes, F3 routes read `API_BASE_URL` from it and `.env.example` documents it; if no, routes use `import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'`. Record the finding in the task notes.

- [ ] **Step 1: Write failing tests.** `refresh-cookie.spec.ts`: with a recording fake jar, assert `writeRefreshToken` calls `set('hyrox_refresh', 'tok', { path: '/session', httpOnly: true, sameSite: 'strict', secure: true, maxAge: 2_592_000 })`; `secure:false` is passed through; `readRefreshToken` returns `null` when `get` yields `undefined` or `''`; `clearRefreshToken` calls `delete('hyrox_refresh', { path: '/session' })`. `backend-auth.spec.ts`: with a fake `fetchImpl`, assert `login` POSTs JSON to `${baseUrl}/auth/login` and returns `{ok:true,value}` on 200; returns `{ok:false,status:401,code:'invalid_credentials'}` on a 401 body; `refresh` POSTs `{refreshToken}` to `/auth/refresh`; `signup` accepts 201; `logout` POSTs `{refreshToken}` and resolves even when fetch rejects; network rejection in `login` returns `{ok:false,status:502,code:'request_failed'}`.
- [ ] **Step 2:** Run the two specs -> FAIL.
- [ ] **Step 3: Implement** both modules to satisfy the tests. `backend-auth.ts` shape:

```ts
async function post<T>(deps: Deps, path: string, body: unknown, okStatus: number): Promise<BackendAuthResult<T>> {
  try {
    const response = await deps.fetchImpl(`${deps.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status !== okStatus) {
      return { ok: false, status: response.status, code: await errorCode(response) };
    }

    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false, status: 502, code: 'request_failed' };
  }
}
```

(Use `okStatus` 201 for signup, 200 for login/refresh.)
- [ ] **Step 4:** specs PASS; `npm run check -w web`.
- [ ] **Step 5:** `git add web/src/lib/server`

---

### Task F3: BFF route handlers `/session/*`

**Files:**
- Create: `web/src/lib/server/session-handlers.ts`, `web/src/lib/server/session-handlers.spec.ts`, `web/src/routes/session/login/+server.ts`, `.../signup/+server.ts`, `.../refresh/+server.ts`, `.../logout/+server.ts`
- Modify: `web/.env.example` (add `REFRESH_COOKIE_MAX_AGE_SECONDS=2592000`; add `API_BASE_URL` only if F2 found `$env/dynamic/private`)

**Interfaces:**
- Consumes: F2 `CookieJar`, cookie helpers, `createBackendAuth`.
- Produces handler functions that hold all logic so route files stay thin: `createSessionHandlers({ backend, secure, maxAgeSeconds }): { login(request: Request, jar: CookieJar): Promise<Response>; signup(...): Promise<Response>; refresh(jar): Promise<Response>; logout(jar): Promise<Response> }` returning standard `Response` objects (use `Response.json`).
  - login/signup: parse JSON body (invalid JSON -> 400 `{message:'validation_failed'}`), call backend, on ok set cookie from `refreshToken` and return `{accessToken, expiresIn, athlete}` (status 200 login / 201 signup) WITHOUT `refreshToken`; on failure return `{statusCode, message: code}` with backend status.
  - refresh: no cookie -> 401 `{message:'invalid_refresh_token'}`; backend ok -> rotate cookie, return `{accessToken, expiresIn}`; backend 401 -> clear cookie and return 401; other failures -> pass status through without clearing the cookie.
  - logout: if cookie, call `backend.logout(token)`; always clear cookie; return 204.

- [ ] **Step 1: Write failing tests** for each branch above using a fake backend (vi.fn) and recording jar. Include `it('never puts the refresh token in the body')` asserting `JSON.stringify(await response.json())` does not contain the token, for login, signup and refresh.
- [ ] **Step 2:** Run -> FAIL.
- [ ] **Step 3: Implement** `session-handlers.ts`. Route files e.g. `refresh/+server.ts`:

```ts
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { createBackendAuth } from '$lib/server/backend-auth.ts';
import { createSessionHandlers } from '$lib/server/session-handlers.ts';

const handlers = createSessionHandlers({
  backend: createBackendAuth({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000', fetchImpl: fetch }),
  secure: !dev,
  maxAgeSeconds: Number(import.meta.env.REFRESH_COOKIE_MAX_AGE_SECONDS ?? 2_592_000),
});

export const POST: RequestHandler = ({ cookies }) => handlers.refresh(cookies);
```

(Existing web code imports with relative paths and `.ts`; if `$lib` alias is not configured/working in vitest, use relative paths instead. Adjust base URL source per the F2 finding. Route files are not unit-tested; they are exercised in F9.)
- [ ] **Step 4:** specs PASS; `npm run check -w web`; `npm run build -w web` (verifies route compilation).
- [ ] **Step 5:** `git add web/src/lib/server web/src/routes/session web/.env.example`

---

### Task F4: Browser auth API client

**Files:**
- Create: `web/src/lib/auth/auth-api.ts`, `web/src/lib/auth/auth-api.spec.ts`

**Interfaces:**
- Consumes: F1 types/`errorCode`.
- Produces: `createAuthApi({ fetchImpl?: typeof fetch }): AuthApi` with `login(email: string, password: string): Promise<AuthGrant>`, `signup(input: { name: string; email: string; password: string; adultAttested: boolean }): Promise<AuthGrant>`, `refresh(): Promise<AccessGrant>`, `logout(): Promise<void>`. All use relative URLs `/session/...`, `method: 'POST'`, `credentials: 'same-origin'`, JSON headers where a body exists. Non-OK -> `throw new AuthApiError(status, await errorCode(response))`. `logout` never throws. Network rejection -> `AuthApiError(0, 'request_failed')`.

- [ ] **Step 1:** Failing tests (fake fetch): login posts `{email,password}` to `/session/login` with `credentials: 'same-origin'` and returns body; signup sends `adultAttested`; refresh posts with no body; 401 -> `AuthApiError` with `status 401, code 'invalid_refresh_token'`; fetch rejection -> `AuthApiError(0,'request_failed')`; logout resolves on rejection.
- [ ] **Step 2:** Run -> FAIL. **Step 3:** Implement. **Step 4:** PASS + check. 
- [ ] **Step 5:** `git add web/src/lib/auth`

---

### Task F5: Session store with single-flight refresh

**Files:**
- Create: `web/src/lib/auth/session.svelte.ts`, `web/src/lib/auth/session.spec.ts`

**Interfaces:**
- Consumes: F4 `AuthApi`, F1 types.
- Produces:

```ts
export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';
export interface LockManagerLike { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
export interface SessionDeps { authApi: AuthApi; now?: () => number; locks?: LockManagerLike | null; fetchMe?: (token: string) => Promise<SessionAthlete | null> }
export interface Session {
  readonly status: SessionStatus;
  readonly athlete: SessionAthlete | null;
  bootstrap(): Promise<void>;                 // idempotent
  login(email: string, password: string): Promise<void>;
  signup(input: SignupInput): Promise<void>;
  logout(): Promise<void>;                     // clears local state even if the API call fails
  refresh(): Promise<boolean>;                 // single-flight; true if a fresh token is held
  getAccessToken(): string | null;
  isExpiringSoon(): boolean;                   // expiresAt - now < 30_000
}
export function createSession(deps: SessionDeps): Session;
export const session: Session;  // app singleton: real AuthApi, Date.now, navigator.locks when present
```

Behavior: `bootstrap` calls `refresh()` then, on success, `fetchMe(token)` (`GET {VITE_API_BASE_URL}/auth/me`, non-fatal -> `athlete: null`); 401 from refresh -> `anonymous`; network error -> `anonymous` (nothing else). `refresh()`: if a refresh promise is already in flight return it; otherwise run `authApi.refresh()` inside `locks.request('hyrox-session-refresh', ...)` when `locks` is provided (inside the lock, if the token was refreshed by this tab while waiting and is not expiring soon, skip the call); on failure with `AuthApiError` clear token and set `anonymous`, return `false`. State uses `$state` fields (`.svelte.ts`).

- [ ] **Step 1: Write failing tests** with fake `authApi`, fake clock, fake locks:
  - when bootstrap refresh succeeds: status authenticated, `getAccessToken()` returns the token, `fetchMe` result stored.
  - when bootstrap refresh 401s: status anonymous, token null.
  - when bootstrap is called twice: `authApi.refresh` called once.
  - when five `refresh()` calls run concurrently: `authApi.refresh` called once, all resolve true.
  - when `locks` provided: `request` called with `'hyrox-session-refresh'`; when `locks` is null: refresh still works.
  - `isExpiringSoon` false at 60 s left, true at 29 s left (fake clock).
  - login success sets authenticated + athlete; login rejection rethrows `AuthApiError` and stays anonymous.
  - logout clears state even when `authApi.logout` rejects.
- [ ] **Step 2:** Run -> FAIL. **Step 3:** Implement. **Step 4:** PASS + check (vitest must compile `.svelte.ts`; if runes are not transformed in tests, confirm `svelteTesting()`/sveltekit plugin handles `*.svelte.ts` and fix config only if needed).
- [ ] **Step 5:** `git add web/src/lib/auth`

---

### Task F6: Authenticated fetch client

**Files:**
- Create: `web/src/lib/auth/authed-fetch.ts`, `web/src/lib/auth/authed-fetch.spec.ts`

**Interfaces:**
- Consumes: F5 `Session` (only `getAccessToken`, `isExpiringSoon`, `refresh`), F1 `NotAuthenticatedError`.
- Produces: `createAuthedFetch({ session, fetchImpl?: typeof fetch }): typeof fetch` (also export `authedFetch` bound to the app `session` and global `fetch` in a separate tiny file `authed-fetch.app.ts` only if needed to avoid importing the singleton in tests). Behavior:
  1. If no token or `isExpiringSoon()`: `await session.refresh()`; if still no token -> throw `NotAuthenticatedError`.
  2. Send with header `Authorization: Bearer <token>` merged over caller headers.
  3. If response is 401: `await session.refresh()`; on success retry exactly once with the new token; on failure or second 401 return/throw: refresh failed -> throw `NotAuthenticatedError`; second 401 -> return that response.
  4. Non-401 responses returned untouched. Restriction (documented in a one-line comment): `init.body` must be re-sendable (string), no streams.

- [ ] **Step 1: Failing tests** (fake session + fake fetch): attaches bearer; preserves caller headers; refreshes first when expiring soon; 401 then refresh ok then retry once with new token; 401 twice returns second response and does not loop; refresh failure throws `NotAuthenticatedError`; no token and refresh yields none throws without calling fetch; 500 not retried.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + check. 
- [ ] **Step 5:** `git add web/src/lib/auth`

---

### Task F7: Pure helpers (safe-next, validation, error messages)

**Files:**
- Create: `safe-next.ts`, `validation.ts`, `auth-errors.ts` and `*.spec.ts` for each, under `web/src/lib/auth/`

**Interfaces:**
- Produces: `safeNext(raw: string | null): string`; `validateLogin(input: {email,password}): Record<string,string>` and `validateSignup(input: {name,email,password,confirmPassword,adultAttested}): Record<string,string>` returning field -> message (empty object when valid; fields `name|email|password|confirmPassword|adultAttested`); `authErrorMessage(code: string, status?: number): string`.

- [ ] **Step 1: Failing table tests.**
  - `safeNext`: `'/dev/body-map'` -> same; `'/a?b=1'` -> same; `null`, `''`, `'//evil.com'`, `'https://evil.com'`, `'/\\evil'`, `'javascript:x'`, `'dev'` -> `'/'`.
  - `validateSignup`: name blank/whitespace/101 chars error; email `'a'` error; password 9 chars error, 10 ok, 129 error; attestation false error; `confirmPassword` differing from `password` -> `confirmPassword` error ("Passwords do not match."), empty confirm with non-empty password -> same error, matching -> no error; fully valid -> `{}`.
  - `validateLogin`: empty email/password errors; valid -> `{}`.
  - `authErrorMessage`: `invalid_credentials` -> "Email or password is incorrect."; `athlete_banned` -> "This account is suspended."; `email_already_registered` -> "That email is already registered."; `adult_attestation_required` -> "You must confirm you are 18 or older."; `validation_failed` -> "Check the highlighted fields and try again."; status 429 (any code) -> "Too many attempts. Wait a minute and try again."; unknown -> "Something went wrong. Try again."
- [ ] **Step 2:** FAIL. **Step 3:** Implement (email shape: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`). **Step 4:** PASS + check.
- [ ] **Step 5:** `git add web/src/lib/auth`

---

### Task F8: Forms, gate, logout button, routes, layout bootstrap

**Files:**
- Create: `LoginForm.svelte`, `SignupForm.svelte`, `AuthGate.svelte`, `LogoutButton.svelte` (+ `LoginForm.spec.ts`, `SignupForm.spec.ts`, `AuthGate.spec.ts`) in `web/src/lib/auth/`; `web/src/routes/login/+page.svelte`; `web/src/routes/signup/+page.svelte`
- Modify: `web/src/routes/+layout.svelte`, `web/src/routes/+page.svelte`

**Interfaces:**
- Consumes: F5 `Session` type + `session` singleton, F7 helpers.
- Produces: `LoginForm` props `{ session: Session; onsuccess: () => void }`; `SignupForm` props same; `AuthGate` props `{ session: Session; goto: (url: string) => void; children: Snippet; loginPath?: string }`; `LogoutButton` props `{ session: Session; onloggedout: () => void }`. Components take `session`/`goto` as props so tests inject fakes; route pages pass the singleton and `$app/navigation` `goto`.

Behavior: forms validate with F7 on submit, show field errors with `aria-describedby`, disable submit while pending, show a `role="alert"` region with `authErrorMessage(error.code, error.status)` on `AuthApiError`, `autocomplete` attributes (`email`, `current-password`, `new-password`, `name`), signup has a confirm-password input (`autocomplete="new-password"`) and an "I am 18 or older" checkbox; `confirmPassword` is passed to `validateSignup` but excluded from the object sent to `session.signup` (type `SignupInput` has no such field). `AuthGate`: `loading` -> "Checking session..." (`role="status"`), `anonymous` -> calls `goto('/login?next=' + encodeURIComponent(current path))` once and renders nothing, `authenticated` -> `children`. Layout: `onMount(() => session.bootstrap())` (client only). Login/signup pages: if already authenticated, `goto(safeNext(url.searchParams.get('next')))`; on success same. Home page: authenticated -> greeting with athlete name, `LogoutButton`, link to the harness; anonymous -> links to `/login` and `/signup`.

- [ ] **Step 1: Failing component tests** (testing-library + user-event, fake session object with `vi.fn()` methods): login submits trimmed email and password to `session.login` then calls `onsuccess`; shows "Email or password is incorrect." when login rejects `AuthApiError(401,'invalid_credentials')`; blocks submit and shows field error for empty email; submit disabled while pending; signup blocks when attestation unchecked, blocks and shows "Passwords do not match." when confirm differs, sends `adultAttested: true` when checked and the payload to `session.signup` contains no `confirmPassword`, maps `email_already_registered`; AuthGate renders status text while loading, calls `goto` with encoded next when anonymous, renders children when authenticated.
- [ ] **Step 2:** FAIL. **Step 3:** Implement components and routes (reuse existing Tailwind classes and focus-ring classes from the harness page). **Step 4:** PASS, `npm run check -w web`, `npm run build -w web`.
- [ ] **Step 5:** `git add web/src/lib/auth web/src/routes`

---

### Task F9: HYR-27 integration, harness cleanup, docs, manual e2e

**Files:**
- Modify: `web/src/lib/floor-price/floor-price-api.ts`, `web/src/lib/floor-price/floor-price-api.spec.ts`, `web/src/routes/dev/body-map/+page.svelte`, `README.md` (short "Web auth" section: BFF routes, cookie, env vars, throttle caveat from spec 4.7)
- Check: `web/src/lib/floor-price/ZoneFloorPricePanel.svelte` and `ZoneFloorPricePanel.spec.ts` for any dependence on the `not_authenticated` code from `FloorPriceApiError`.

**Interfaces:**
- Consumes: F6 `createAuthedFetch`, F5 `session`, F8 `AuthGate`, `LogoutButton`.
- Produces: `FloorPriceApiOptions` becomes `{ baseUrl: string; fetchImpl?: typeof fetch }` (remove `getAccessToken`). `NotAuthenticatedError` propagates from `send`; the harness treats it as "session ended" (AuthGate will redirect).

- [ ] **Step 1:** Update `floor-price-api.spec.ts` first: delete `getAccessToken` mock and the "throws not_authenticated when no token" case, and drop the `Authorization` expectations (header is now the authed fetch's job); keep URL/method/body/error-code cases. Run -> existing tests that referenced removed options FAIL (type or assertion).
- [ ] **Step 2:** Edit `floor-price-api.ts`: remove `getAccessToken` and the token pre-check; `send` just calls `(options.fetchImpl ?? fetch)(url, init)`. Run floor-price specs -> PASS.
- [ ] **Step 3:** Rewrite the harness page: wrap content in `<AuthGate {session} {goto}>`, construct the api once with `fetchImpl: createAuthedFetch({ session })`, `$effect`/`onMount` to call `loadPrices()` once authenticated, delete the "Access token (dev only)" block and the `accessToken` state, keep the `loadFailed` message (reword: "Could not load prices. Try again."), add `LogoutButton`.
- [ ] **Step 4:** Run `npm test -w web`, `npm run check -w web`, `npm run build -w web`; also `npm test -w shared` (untouched, sanity).
- [ ] **Step 5: Manual e2e** (record results in the final message): start postgres + backend + `npm run dev -w web`; (a) sign up with a new email, lands on `/`; (b) reload, still signed in (cookie `hyrox_refresh` is httpOnly, path `/session`, visible only in devtools Application tab; confirm `document.cookie` does not show it and `localStorage` is empty); (c) open `/dev/body-map` signed out -> redirected to `/login?next=%2Fdev%2Fbody-map`, after login returns there; (d) set a floor price, confirm it saves; (e) shorten `JWT_ACCESS_TTL_SECONDS=60` temporarily, wait past expiry, save again -> succeeds via silent refresh (watch network: one `/session/refresh`); (f) two tabs, expire, act in both within the same second -> both succeed, no forced logout (Web Locks); (g) logout -> cookie gone, `/dev/body-map` redirects; (h) wrong password shows the incorrect-credentials message; (i) 11 rapid bad logins -> throttle message. Note any deviation.
- [ ] **Step 6:** `git add -A web README.md`; stop (do not commit). Tell the user it is staged and can be reviewed with `/crit`; Linear HYR-30 -> In Review.

---

## Self-review (spec coverage)

- Login/signup UI: F7, F8. Token storage (memory + httpOnly cookie): F2, F3, F5. Refresh handling (bootstrap, proactive, reactive, single-flight, locks): F5, F6. Shared authed fetch: F6. Dev token field replaced: F9. BFF contract, cookie flags, no refresh token in JSON: F2, F3. `safeNext`: F7/F8. Error mapping and 429: F7. Env/config: F2/F3. HYR-27 refactor (D7): F9. Docs and throttle caveat: F9.
- Type consistency: `AuthApi` (F4) -> `Session` (F5) -> `createAuthedFetch` (F6) -> components (F8) -> harness (F9); `AccessGrant`/`AuthGrant`/`NotAuthenticatedError` defined in F1 only.
