# HYR-31: Per-Client-IP Auth Throttle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nest's `/auth/login|signup|refresh` throttle keys on the real client IP instead of the web server's IP.

**Architecture:** Nest sets Express `trust proxy` to a configured hop count (`TRUST_PROXY_HOPS`, default 0) so `req.ip` derives from `X-Forwarded-For`. The SvelteKit BFF resolves the client IP with `getClientAddress()` and overwrites `X-Forwarded-For` with that single value on every backend call.

**Tech Stack:** NestJS 12.1.1 (Express platform), `@nestjs/throttler` 6.7.1, Vitest, SvelteKit (web workspace). No new dependencies.

**Spec:** `docs/specs/2026-10-09-auth-throttle-client-ip-design.md` (read sections 3 and 6 first).

## Global Constraints

- No new dependencies. Do not add supertest; use `@nestjs/testing` plus global `fetch` on an ephemeral port.
- `TRUST_PROXY_HOPS`: integer 0..10, default 0. Hop count, never boolean `true`. 0 means Express `trust proxy` = `false`.
- BFF sends exactly one `X-Forwarded-For` value (overwrite, never append, never forward the browser's header). If the client IP is unknown, send no XFF; auth must still work.
- No change to throttle limits (`SENSITIVE_ROUTE_LIMIT` 10 per 60_000 ms, global 60 per 60_000 ms) and no custom throttler `getTracker`.
- Style (CLAUDE.md): exact-pinned deps (none), explicit return types on every function, no single-letter names (except `i/j/k` in indexed loops), no inline `if` (brace, body on its own line), blank line before `if/for/while/return/throw` unless first in block, no `!!x`, no nested function declarations, numeric separators on literals of 5+ digits, no barrel files, `readonly` constructor params, snake_case error codes, comments only for a non-obvious why. Delete dead code. Backend imports without extension; web server code imports with `.ts` extension as existing web code does.
- Tests: Vitest, nested `describe` per condition ("when ..."), short `it` titles stating only the outcome, shared setup in that `describe`'s `beforeEach`. No real external network.
- Gates: backend `npm test` and `npx tsc --noEmit -p tsconfig.json` and `npm run lint`; web `npm test -w web` and `npm run check -w web`. Prettier for web: `--single-quote --print-width 100`.
- Git: stage each task's files with `git add`, do NOT commit; the user reviews with `/crit`. Later commits use Conventional Commits (`feat(auth): ...`, `feat(web): ...`) ending with the Co-Authored-By line from the session. Branch is `hyr-31`; never rename after a PR exists. Move Linear HYR-31 to In Progress at build start (check state first), In Review only when staged.

## Track layout

Two independent tracks that only share the header contract (`X-Forwarded-For`, one value). They can be built in parallel.
- Backend track: B1, B2, B3 (sequential: B2 consumes B1's env field, B3 consumes B2's helper).
- Frontend track: F1, F2, F3 (sequential).
- Docs and manual e2e: D1, after both tracks.

## File structure

Backend: modify `src/config/env.validation.ts`, `src/main.ts`, `.env.example`; create `src/common/trust-proxy.ts`, `src/common/trust-proxy.spec.ts`, `src/config/env.validation.spec.ts` (if absent), `src/auth/auth-throttle-client-ip.spec.ts`.
Web: create `web/src/lib/server/client-ip.ts` + spec; modify `web/src/lib/server/backend-auth.ts` + spec, `web/src/lib/server/session-handlers.ts` + spec, `web/src/routes/session/{login,signup,refresh,logout}/+server.ts`.
Docs: modify `README.md`, `web/.env.example`.

---

### Task B1: `TRUST_PROXY_HOPS` env var

**Files:**
- Modify: `src/config/env.validation.ts`, `.env.example`
- Test: `src/config/env.validation.spec.ts` (create if missing; if it exists, extend it)

**Interfaces:**
- Produces: `EnvironmentVariables.TRUST_PROXY_HOPS: number` (default 0), readable via `config.get('TRUST_PROXY_HOPS', { infer: true })`.

- [ ] **Step 1: Write the failing test.** Build a minimal valid raw env (DATABASE_URL, JWT_SECRET of 32+ chars, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY) and call `validateEnv`. Cases:

```ts
describe('validateEnv TRUST_PROXY_HOPS', () => {
  describe('when it is not set', () => {
    it('defaults to 0', () => {
      expect(validateEnv(BASE_ENV).TRUST_PROXY_HOPS).toBe(0);
    });
  });

  describe('when it is a string integer from 0 to 10', () => {
    it.each(['0', '1', '10'])('accepts %s as a number', (value) => {
      expect(validateEnv({ ...BASE_ENV, TRUST_PROXY_HOPS: value }).TRUST_PROXY_HOPS).toBe(Number(value));
    });
  });

  describe('when it is out of range or not an integer', () => {
    it.each(['-1', '11', '1.5', 'abc', 'true'])('rejects %s', (value) => {
      expect(() => validateEnv({ ...BASE_ENV, TRUST_PROXY_HOPS: value })).toThrow('env_invalid');
    });
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/config/env.validation.spec.ts`. Expected: FAIL (default undefined; invalid values accepted).
- [ ] **Step 3:** Add the field to `EnvironmentVariables` using the same decorator pattern as `PORT`/`JWT_ACCESS_TTL_SECONDS`: `@Type(() => Number)`, `@IsInt()`, `@Min(0)`, `@Max(MAX_TRUST_PROXY_HOPS)` with a named constant `MAX_TRUST_PROXY_HOPS = 10` and a named default constant, default `0`. Add `TRUST_PROXY_HOPS=1` to `.env.example` (local dev: BFF connects straight to Nest).
- [ ] **Step 4:** Re-run the spec. Expected: PASS. Run `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5:** `git add src/config/env.validation.ts src/config/env.validation.spec.ts .env.example`

---

### Task B2: `applyTrustProxy` helper and bootstrap wiring

**Files:**
- Create: `src/common/trust-proxy.ts`, `src/common/trust-proxy.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `TRUST_PROXY_HOPS` from B1.
- Produces: `export function applyTrustProxy(app: Pick<NestExpressApplication, 'set'>, hops: number): void`. Calls `app.set('trust proxy', hops === 0 ? false : hops)`.

- [ ] **Step 1: Write the failing test** with a fake `{ set: vi.fn() }`:

```ts
describe('applyTrustProxy', () => {
  describe('when hops is 0', () => {
    it('disables trust proxy', () => {
      const app = { set: vi.fn() };
      applyTrustProxy(app, 0);
      expect(app.set).toHaveBeenCalledWith('trust proxy', false);
    });
  });

  describe('when hops is positive', () => {
    it('sets the numeric hop count', () => {
      const app = { set: vi.fn() };
      applyTrustProxy(app, 2);
      expect(app.set).toHaveBeenCalledWith('trust proxy', 2);
    });
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/common/trust-proxy.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the helper per the interface above (one short function, explicit `void` return type). In `src/main.ts`: use `NestFactory.create<NestExpressApplication>(AppModule)` (type import from `@nestjs/platform-express`), then call `applyTrustProxy(app, config.get('TRUST_PROXY_HOPS', { infer: true }))` before `app.listen`.
- [ ] **Step 4:** Run the spec (PASS), `npx tsc --noEmit -p tsconfig.json`, `npm run lint`.
- [ ] **Step 5:** `git add src/common/trust-proxy.ts src/common/trust-proxy.spec.ts src/main.ts`

---

### Task B3: Throttle-per-client-IP integration test

**Files:**
- Test (create): `src/auth/auth-throttle-client-ip.spec.ts`

**Interfaces:**
- Consumes: `applyTrustProxy` (B2), real `ThrottlerGuard` / `ThrottlerModule` / `@Throttle`.

This is a test-only task: it proves the wiring end to end. No production code should change unless the test exposes a real defect.

- [ ] **Step 1: Write the test.** Inside the spec define a throwaway `@Controller('probe')` with `@Post() @HttpCode(200) @Throttle({ default: { limit: 2, ttl: 60_000 } })` returning `{ ok: true }`. A helper `startApp(hops: number)` builds a testing module with `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])`, `{ provide: APP_GUARD, useClass: ThrottlerGuard }` and the controller, creates `NestExpressApplication`, calls `applyTrustProxy(app, hops)`, `await app.listen(0)`, and returns the app plus base URL from `app.getUrl()`. A helper `post(baseUrl, forwardedFor?)` does `fetch` POST with the optional `X-Forwarded-For` header and returns the status. Close the app in `afterEach`. Cases (nested describes):

```ts
describe('auth throttle keying', () => {
  describe('when one trusted hop and clients send different X-Forwarded-For values', () => {
    // beforeEach: startApp(1)
    it('gives each client its own bucket', async () => {
      // 2 calls as 203.0.113.1 -> 200,200 ; 2 calls as 203.0.113.2 -> 200,200
    });
    it('rejects the third call from the same client', async () => {
      // 3 calls as 203.0.113.1 -> 200,200,429
    });
  });

  describe('when one trusted hop and the client forges extra leftmost entries', () => {
    it('still throttles on the rightmost entry', async () => {
      // header `forged-a, 203.0.113.9` , `forged-b, 203.0.113.9`, `forged-c, 203.0.113.9` -> 200,200,429
    });
  });

  describe('when no hops are trusted', () => {
    // beforeEach: startApp(0)
    it('ignores X-Forwarded-For and shares one bucket', async () => {
      // XFF 203.0.113.1, .2, .3 -> 200,200,429
    });
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/auth/auth-throttle-client-ip.spec.ts`. Expected: PASS (B2 already provides the behavior). To prove the test has teeth, temporarily make `startApp(1)` skip `applyTrustProxy`, confirm the first case fails (all XFF values share one bucket), then restore.
- [ ] **Step 3:** Run full backend gate: `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`.
- [ ] **Step 4:** `git add src/auth/auth-throttle-client-ip.spec.ts`

---

### Task F1: `resolveClientIp` helper

**Files:**
- Create: `web/src/lib/server/client-ip.ts`, `web/src/lib/server/client-ip.spec.ts`

**Interfaces:**
- Produces: `export function resolveClientIp(getClientAddress: () => string): string | null`. Returns the trimmed address; `null` if the function throws or the result is empty after trim.

- [ ] **Step 1: Write the failing test:**

```ts
describe('resolveClientIp', () => {
  describe('when the adapter resolves an address', () => {
    it('returns it', () => {
      expect(resolveClientIp(() => '203.0.113.7')).toBe('203.0.113.7');
    });
  });

  describe('when the adapter throws', () => {
    it('returns null', () => {
      expect(resolveClientIp(() => { throw new Error('no address'); })).toBeNull();
    });
  });

  describe('when the address is empty', () => {
    it('returns null', () => {
      expect(resolveClientIp(() => '  ')).toBeNull();
    });
  });
});
```

- [ ] **Step 2:** `npm test -w web -- client-ip`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement per the interface (try/catch with an unnamed catch like the existing `readBody`, explicit return type).
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** `git add web/src/lib/server/client-ip.ts web/src/lib/server/client-ip.spec.ts`

---

### Task F2: `BackendAuth` forwards `X-Forwarded-For`

**Files:**
- Modify: `web/src/lib/server/backend-auth.ts`
- Test: `web/src/lib/server/backend-auth.spec.ts` (extend; read the existing fake `fetchImpl` setup first and reuse it)

**Interfaces:**
- Consumes: nothing new.
- Produces (new `BackendAuth` signatures; `clientIp: string | null` is a required last parameter on every method so callers cannot forget it):
  - `login(email: string, password: string, clientIp: string | null)`
  - `signup(input: SignupInput, clientIp: string | null)`
  - `refresh(refreshToken: string, clientIp: string | null)`
  - `logout(refreshToken: string, clientIp: string | null): Promise<void>`
  - The internal `post` helper takes `clientIp` and builds headers: `Content-Type: application/json` always, plus `X-Forwarded-For: <clientIp>` only when non-null.

- [ ] **Step 1: Write failing tests** (existing tests that call the methods need the extra argument; update them with `null`). New cases, each asserting on `fetchImpl.mock.calls[0][1].headers`:

```ts
describe('X-Forwarded-For', () => {
  describe('when a client IP is given', () => {
    it.each(['login', 'signup', 'refresh', 'logout'])('sends it on %s', async (method) => {
      // call backend[method](..., '203.0.113.7'); expect headers['X-Forwarded-For'] === '203.0.113.7'
    });
  });

  describe('when the client IP is null', () => {
    it('omits the header', async () => {
      // expect headers not to have 'X-Forwarded-For'
    });
  });
});
```

- [ ] **Step 2:** `npm test -w web -- backend-auth`. Expected: FAIL.
- [ ] **Step 3:** Implement the signature changes and header building. Do not forward any other inbound header.
- [ ] **Step 4:** Re-run backend-auth spec: PASS. `npm run check -w web` will fail in `session-handlers.ts` until F3; that is expected here, do not stub around it.
- [ ] **Step 5:** `git add web/src/lib/server/backend-auth.ts web/src/lib/server/backend-auth.spec.ts`

---

### Task F3: Handlers and routes pass the client IP

**Files:**
- Modify: `web/src/lib/server/session-handlers.ts`, `web/src/routes/session/login/+server.ts`, `.../signup/+server.ts`, `.../refresh/+server.ts`, `.../logout/+server.ts`
- Test: `web/src/lib/server/session-handlers.spec.ts` (extend)

**Interfaces:**
- Consumes: `BackendAuth` signatures from F2, `resolveClientIp` from F1.
- Produces (`SessionHandlers`, `clientIp: string | null` appended as last parameter):
  - `login(request: Request, jar: CookieJar, clientIp: string | null): Promise<Response>`
  - `signup(request: Request, jar: CookieJar, clientIp: string | null): Promise<Response>`
  - `refresh(jar: CookieJar, clientIp: string | null): Promise<Response>`
  - `logout(jar: CookieJar, clientIp: string | null): Promise<Response>`
  - Each route: `({ request, cookies, getClientAddress }) => sessionHandlers.login(request, cookies, resolveClientIp(getClientAddress))` (and analogues).

- [ ] **Step 1: Write failing tests.** Update existing handler calls with a third/second `null` argument. Add one case per handler under a `describe('client IP forwarding')`:

```ts
describe('when a client IP is given', () => {
  it('passes it to the backend on login', async () => {
    backend.login.mockResolvedValue({ ok: false, status: 401, code: 'invalid_credentials' });
    await handlers.login(jsonRequest({ email: 'a@b.co', password: 'pw' }), createFakeJar(), '203.0.113.7');
    expect(backend.login).toHaveBeenCalledWith('a@b.co', 'pw', '203.0.113.7');
  });
  // same shape for signup, refresh (needs a refresh cookie in the fake jar), logout (same)
});
```

Add a case that a malformed login body (400 `validation_failed`) never calls the backend regardless of IP (existing behavior retained).
- [ ] **Step 2:** `npm test -w web -- session-handlers`. Expected: FAIL.
- [ ] **Step 3:** Update the `SessionHandlers` interface, implementations, and the four `+server.ts` routes. Keep the BFF's rule: never read or forward the request's own `X-Forwarded-For` header; the only source is `getClientAddress()`.
- [ ] **Step 4:** Run `npm test -w web` and `npm run check -w web` and `npm run build -w web`. Expected: all PASS.
- [ ] **Step 5:** `git add web/src/lib/server/session-handlers.ts web/src/lib/server/session-handlers.spec.ts web/src/routes/session`

---

### Task D1: Docs, prod notes, manual e2e

**Files:**
- Modify: `README.md`, `web/.env.example`

Runs after both tracks are staged.

- [ ] **Step 1:** README env list (line starting `Env:`): add `TRUST_PROXY_HOPS` (integer 0..10, default 0; number of proxies between the client IP the BFF resolved and Nest, counting the BFF itself; never use `true`).
- [ ] **Step 2:** README "Web auth (HYR-30)": replace the "Throttle caveat" bullet with a short HYR-31 paragraph: the BFF overwrites `X-Forwarded-For` with `getClientAddress()`, Nest trusts `TRUST_PROXY_HOPS`. Add a "Production notes (for HYR-32)" list copying spec section 6 items 1-4 in condensed form: ingress must not expose `/auth/*` publicly when hops >= 1 (else XFF spoofing bypasses the limit), hop count must match topology and be re-verified after infra changes, web adapter must be configured for its own proxies (`ADDRESS_HEADER`, `XFF_DEPTH` on adapter-node) or `getClientAddress()` returns the ingress IP, throttler store is per-instance in-memory.
- [ ] **Step 3:** `web/.env.example`: add a comment-free reminder only if the file lists server env; otherwise leave it. (No new web env var is introduced.)
- [ ] **Step 4: Manual e2e.** Start postgres and API with `TRUST_PROXY_HOPS=1`, run web dev. From the web app submit wrong-password login 11 times: expect 429 on the 11th. Then `curl -i -X POST localhost:3000/auth/login -H 'Content-Type: application/json' -H 'X-Forwarded-For: 198.51.100.5' -d '{"email":"a@b.co","password":"x"}'` expecting 401 (a different IP is not throttled). Restart with `TRUST_PROXY_HOPS=0` and confirm XFF no longer changes the bucket. Note in the staging message that dev `getClientAddress()` may be unavailable, in which case the BFF omits the header (falls back to shared bucket); if so, run the web build via `npm run build -w web` with a node adapter or use the unit and integration tests as the proof.
- [ ] **Step 5:** `git add README.md`, then stop: tell the user it is staged and they can run `/crit`.
