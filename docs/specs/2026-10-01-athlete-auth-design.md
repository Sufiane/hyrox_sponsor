# HYR-3: Athlete Signup/Auth + 18+ Self-Attestation — Design Spec

Status: Draft, pending user sign-off on the open-question recommendations (section 9)
Ticket: Linear HYR-3 (project "Hyrox Sponsor — MVP", milestone M0 — Foundations). Blocked by HYR-2 (merged, commit 01634d6).
Date: 2026-10-01

## 1. Context

HYR-2 shipped the data model with no HTTP surface. `Athlete` already has `email` (unique), `name`, `isAdult` (default false) and `adultAttestedAt` (nullable timestamptz), but no credential column. The only athlete code is `AthleteDb.findById` and `AthleteService.getById`. `main.ts` has `helmet` and nothing else; no controllers, `ValidationPipe`, CORS or rate limiting exist. HYR-2 explicitly deferred these to HYR-3: password/auth fields, athlete email normalisation, CORS, `ValidationPipe`, throttler.

Product context (HYR-2 spec section 2): US-only, web-only MVP, athletes auction body-zone ad space; bidders are guest checkout and have no account; 18+ is self-attestation only, no automated checks.

## 2. Scope

In:
- Athlete signup (email + password + name + 18+ attestation), login, token refresh, logout, and a guarded `GET /auth/me`.
- A reusable `JwtAuthGuard` and `@CurrentAthleteId()` decorator for later tickets (HYR-5 race logging etc.).
- Schema: password hash column, refresh token table, DB-level attestation consistency check.
- Platform hardening HYR-2 deferred: global `ValidationPipe`, CORS allowlist, rate limiting.

Out (deferred, see section 9): email verification, password reset, OAuth/magic link, MFA, roles/admin auth (staff review in HYR-6 needs its own ticket), bidder accounts, frontend.

## 3. Approach

Chosen: email + password (argon2id), short-lived stateless access JWT, opaque rotating refresh token persisted hashed in Postgres.

Alternatives considered:
- Magic link/OAuth only: no password handling, but requires an email-sending integration (not in the stack yet) and an external provider; not worth it for M0.
- Server sessions (cookie + session table): simplest revocation, but the frontend is a separate web app and later tickets may want non-browser clients; stateless access tokens avoid a DB hit per request. Cost accepted: up to one access TTL of lag on ban/revocation.
- Access JWT only, no refresh: forces long-lived JWTs that cannot be revoked. Rejected.

## 4. Architecture

Follows the repo's hexagonal split. No usecase layer: signup, login and refresh are each a short orchestration over db calls plus the hasher and token helpers; none has the multi-intent branching that warrants extraction. Revisit only if refresh-rotation or signup grows.

```
AuthController -> AuthService -> AthleteService -> AthleteDb        (athlete table owner)
                              -> RefreshTokenDb                     (refresh_tokens, in auth/)
                              -> TokenService (JWT + opaque token generation, no DB)
                              -> PasswordHasher (argon2 adapter)
```

- `athletes/` stays the sole owner of athlete reads/writes. It gains `findByEmail` and `register`. The 18+ invariant lives in `AthleteService.register` because it is a rule of creating an athlete, not of HTTP or tokens.
- `auth/` owns credentials-to-tokens: signup/login/refresh/logout orchestration, refresh token persistence, guard, controller.
- `PasswordHasher` is the only file importing `argon2` (third-party adapter boundary, where `PasswordHash` brand is cast through its validating constructor).
- `refresh-token.db.ts` is the only auth file importing Prisma.
- `AuthModule` imports `AthletesModule` (already exports `AthleteService`).

## 5. Schema changes

New migration (additive; do not edit the existing init migration, it may already be applied elsewhere): `add_athlete_auth`.

`Athlete`:
- `passwordHash String @map("password_hash")` (NOT NULL). The migration fails on a non-empty `athletes` table; acceptable since nothing is deployed and no athlete-creation code exists. Dev DBs reset with `prisma migrate reset`.
- Hand-written backstop (same pattern as HYR-2's floor-price CHECK):
  `CHECK (is_adult = false OR adult_attested_at IS NOT NULL)` named `athletes_adult_attestation_consistent`.

New `RefreshToken` (`@@map("refresh_tokens")`):
- `id` cuid, `athleteId` FK, `tokenHash String @unique @map("token_hash")` (SHA-256 hex of the opaque token; the plaintext token is never stored), `expiresAt` timestamptz(3), `revokedAt` timestamptz(3) nullable, `createdAt`.
- `@@index([athleteId])`.
- Back-relation `refreshTokens RefreshToken[]` on `Athlete`.

Conventions per HYR-2: snake_case `@map`/`@@map`, every DateTime `@db.Timestamptz(3)`.

## 6. Behaviour

### 6.1 Endpoints

| Route | Auth | Success | Notes |
|---|---|---|---|
| `POST /auth/signup` | none | 201 `{ athlete, accessToken, refreshToken, expiresIn }` | auto-login |
| `POST /auth/login` | none | 200 same shape | |
| `POST /auth/refresh` | refresh token in body | 200 `{ accessToken, refreshToken, expiresIn }` | rotates |
| `POST /auth/logout` | refresh token in body | 204 | idempotent, revokes that token |
| `GET /auth/me` | access JWT | 200 `athlete` | proves the guard |

`athlete` public shape: `{ id, name, email, isAdult }`. Never includes `passwordHash` or trust/ban/Stripe fields.

### 6.2 Signup

Input: `name` (trimmed, 1-100), `email` (valid format, normalised via `normalizeEmail`), `password` (10-128 chars, no composition rules), `adultAttested` (boolean).
- `adultAttested` missing or not exactly `true`: 400 `adult_attestation_required`. Nothing is created.
- On success the athlete row gets `isAdult = true` and `adultAttestedAt = now()` (server clock; client never supplies the timestamp).
- Email already registered: 400 `email_already_registered`. Enforced by the unique index; `AthleteDb.create` translates the Prisma unique-violation (P2002) into `null` and the service throws (db layer throws no domain errors).
- Known tradeoff: the 400 code reveals that an email is registered (account enumeration). Accepted for MVP; fixing it needs email verification.

### 6.3 Login

- Unknown email or wrong password: 401 `invalid_credentials` (same code, same cost: for an unknown email the hasher verifies against a dummy hash so timing does not reveal existence).
- Correct password but `isBanned`: 403 `athlete_banned`, no tokens issued.
- Success issues an access JWT and a new refresh token row.

### 6.4 Tokens

- Access: JWT HS256 via `@nestjs/jwt`, claims `sub = athleteId`, TTL 900 s (env `JWT_ACCESS_TTL_SECONDS`). Verification pins `algorithms: ['HS256']`. Secret `JWT_SECRET`, at least 32 chars, validated at boot (app refuses to start otherwise). No role claims yet.
- Refresh: 32 random bytes, base64url, TTL 30 days (env `REFRESH_TOKEN_TTL_SECONDS`), stored as SHA-256 hash.
- Rotation on `/auth/refresh`: look up by hash; atomically revoke the presented token (`UPDATE ... WHERE revoked_at IS NULL`, count must be 1); then issue a new pair. Revoke-first fails closed: a crash in between logs the user out rather than leaving two live tokens.
- Reuse detection: presenting an already-revoked token (or losing the atomic revoke race) revokes all of that athlete's refresh tokens and returns 401 `invalid_refresh_token`; the readable reason goes to the log. Expired, unknown and revoked tokens all return the same 401 code.
- Refresh re-checks the athlete exists and is not banned (403 `athlete_banned`), so a ban takes effect within one access TTL.
- Transport: both tokens in the JSON body. Cookie transport is deferred to the frontend ticket (needs a CORS credentials decision).

### 6.5 Guard

`JwtAuthGuard` reads `Authorization: Bearer <jwt>`, verifies via `TokenService`, sets `request.athleteId` (branded `AthleteId`). Missing/invalid/expired: 401 `invalid_token`. Stateless: does not hit the DB.

### 6.6 Platform hardening

- Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`) with `exceptionFactory` producing `BadRequestException('validation_failed')` and logging the field details (snake_case code convention).
- CORS: allowlist from `CORS_ORIGINS` (comma-separated); default none (deny cross-origin).
- Rate limiting: `@nestjs/throttler` global guard, default 60 req/min/IP; `signup`, `login`, `refresh` 10 req/min/IP.

### 6.7 Error codes

`adult_attestation_required` (400), `validation_failed` (400), `invalid_credentials` (401), `invalid_refresh_token` (401), `invalid_token` (401), `athlete_banned` (403), `email_already_registered` (400). Throw site logs readable detail with ids via a per-class `Logger`; passwords, tokens and hashes are never logged.

## 7. Branded types (`src/common`)

- `PasswordHash` (`password-hash.ts`): constructor requires an `$argon2id$` prefix; cast only in `PasswordHasher`.
- `RefreshTokenHash` (`refresh-token-hash.ts`): constructor requires 64 lowercase hex chars; built in `TokenService`, so a plaintext token cannot be passed where a hash is expected.
- Reuse `AthleteId` and `NormalizedEmail`. Do not brand the plaintext password, tokens as strings, name, or TTL numbers.
- Pure helpers throw only snake_case codes (`password_hash_invalid`, `refresh_token_hash_invalid`) and never log.

## 8. Testing

Vitest, repo patterns: `Test.createTestingModule` with `mockDeep<Db>()`, nested `describe` per condition (`when ...`), short outcome-only `it` titles, `Logger.prototype.warn` spied for not-found/log assertions. Unit coverage per component (see plan). No DB-backed integration suite exists in the repo; end-to-end behaviour (migration plus curl flow against Postgres on port 5435) is a manual verification step for `qa-verifier`.

## 9. Open design questions and recommendations

1. Auth mechanism: password vs magic link vs OAuth. Recommend password (argon2id). Magic link needs email sending, which does not exist yet. Revisit OAuth (Google) post-MVP.
2. JWT vs sessions. Recommend stateless access JWT (15 min) plus DB-backed refresh. Cost: ban/revocation lags up to 15 min on already-issued access tokens; acceptable because banning is rare and refresh blocks banned athletes.
3. Refresh tokens. Recommend yes, rotating with reuse detection, hashed at rest. Without them the access TTL must be long.
4. Token transport (body vs httpOnly cookie). Recommend body now, cookie when the frontend ticket decides on same-site/CORS credentials. Risk: frontend must store the refresh token; XSS exposure is the cost.
5. Email verification. Recommend defer. Nothing sensitive is gated on email yet (payouts in HYR-14 and bib verification in HYR-6 are the real gates). Adds email-sending infra. Consequence: anyone can register an email they do not own; mitigate in HYR-14 by requiring verified email before Connect onboarding.
6. DOB vs boolean attestation. Recommend boolean plus server timestamp, which is what the schema and the locked product decision ("18+ self-attestation only") already say. DOB would be PII we do not need and still unverified. Weakness: no attestation text/version stored; if legal wants it, add `adultAttestationVersion` later.
7. Schema changes. Recommend the additive migration in section 5, `passwordHash` NOT NULL, plus the DB CHECK so no code path can set `isAdult` without a timestamp.
8. Password policy. Recommend length 10-128, no composition rules, no breach-list check yet.
9. Signup enumeration (400 `email_already_registered`; user chose 400 over 409, 500 rejected as it signals a server fault). Accepted for MVP (see 6.2).
10. Admin/staff auth for HYR-6 review. Recommend a separate ticket; `sub` is an athlete id only for now.
11. Rate limiting behind a proxy. Throttler keys on client IP; behind Railway/Cloudflare, Express needs `trust proxy` configured or every request shares the proxy IP. Recommend deciding at deploy time; not set in this ticket.
12. Hashing library. Recommend `argon2` (native, prebuilt binaries) over `node:crypto` scrypt; scrypt would avoid a native dependency if the prebuild causes CI/deploy trouble.

## 10. Dependencies (exact pins, resolved from npm on 2026-10-01; re-resolve from lockfile on install)

`argon2` 0.45.1, `@nestjs/jwt` 12.0.2, `@nestjs/throttler` 6.7.1, `class-validator` 0.15.1, `class-transformer` 0.5.1. All Nest peers accept v12. Rewrite package.json entries without carets after install.
