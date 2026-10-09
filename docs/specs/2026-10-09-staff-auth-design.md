# HYR-29: Staff Authentication and Authorization (StaffGuard, StaffId) - Design

Status: REVISED after product-owner decisions (D2 optional `--password`, D3 access + refresh tokens, D5 no roles confirmed). Remaining decisions D1, D4, D6-D11 (section 8) carry a recommendation and still need confirmation. Backend-only. Follows HYR-3 (athlete auth), HYR-6 (bib verification, which already ships the `StaffId` brand and `ReviewVerificationUsecase`). Blocks HYR-33 (bib review endpoints).

## 1. Context and findings

- HYR-3 auth (`src/auth/`): password + argon2id (`PasswordHasher`, with a dummy-hash verify so unknown emails cost the same time), HS256 access JWT signed with `JWT_SECRET` (`{ sub: athleteId }`, 15 min), opaque rotating refresh tokens (32 random bytes base64url, SHA-256 hashed at rest in `refresh_tokens`, 30 days), `JwtAuthGuard` that sets `request.athleteId`, `@CurrentAthleteId()` returning `AthleteId | undefined`. Refresh flow: look up by hash; unknown / expired give 401 `invalid_refresh_token`; an already-revoked token, or losing the atomic `revokeIfActive` race, is treated as reuse and revokes all of that athlete's tokens; the atomic revoke happens before issuing the new pair (fail closed). Login/refresh/signup are throttled 10/min/IP. There are no roles. `AuthModule` exports only `JwtAuthGuard` and `TokenService`; `PasswordHasher` is not exported.
- The athlete `RefreshToken` table has an FK to `athletes`, so it cannot hold staff tokens. The athlete `AuthService`/`RefreshTokenDb` are athlete-typed (`AthleteId`) and `TokenService.createRefreshToken()` bakes in the athlete TTL.
- `SignupDto` password rule: string, length 10-128 (literals in the DTO).
- `Athlete` carries athlete-only concerns (trust score, strikes, ban, Stripe Connect). Signup is public.
- `StaffId` (`Brand<string, 'StaffId'>`) and `staffId()` (trim, 1-64 chars, `InvalidValueError('staff_id_invalid')`) already exist in `src/common/ids.ts` from HYR-6, with a spec. Nothing supplies one at runtime yet.
- `ReviewVerificationUsecase` takes `reviewerId: StaffId` and writes `race_entries.verified_by`, a plain nullable string with no FK (HYR-6 decision). HYR-6 suggested `/admin/race-entries/...` for the staff API.
- Conventions that bind this work: hexagonal `*.service.ts` / `*.db.ts` split (dependency-cruiser enforces), branded types cast only in `*.db.ts` or `src/common` constructors, snake_case error codes with readable detail logged, explicit return types, no barrel files, exact dep pinning, Vitest nested `describe` per condition, validated `EnvironmentVariables`.
- `trust proxy` is not set; throttling keys on the proxy IP until HYR-31.

## 2. Goal and non-goals

Goal: a staff member with an account can log in and get an access + refresh token pair, refresh it with rotation and reuse detection, and log out; a route annotated with `@UseGuards(StaffGuard)` accepts only a valid staff access token for an active staff account; the handler obtains a validated `StaffId` through `@CurrentStaffId()`. Athlete tokens never work on staff routes and staff tokens never work on athlete routes.

Non-goals: bib review endpoints (HYR-33), staff-facing web UI (and any cookie/BFF handling for staff), roles (D5), password reset by email, MFA, self-service password change, staff management HTTP API, audit log table, `verified_by` foreign key, a generalisation refactor of the athlete refresh code.

## 3. Approaches considered

### 3.1 Identity source (D1)

1. **Separate `staff_members` table. Recommended.** Own credentials, own active flag, own secret. Staff never go through public signup, share no columns with athlete-only concerns, and an athlete-token bug cannot confer staff power because the token is signed with a different secret and checked against a different table. One person who is both athlete and staff has two independent accounts (cost: two logins, accepted).
2. `role` column on `Athlete`. Staff would pass through public signup and the athlete JWT; privilege escalation becomes a single column write; athlete-only invariants pollute staff rows. Rejected.
3. External IdP/SSO. Strongest long term, but a new vendor for a handful of internal users. Revisit later; the guard and `@CurrentStaffId()` surface stays valid because only the verifier would change.

### 3.2 Token model (D3, DECIDED by product owner)

Short-lived access JWT plus an opaque rotating refresh token, as in HYR-3.

1. **Mirror the athlete flow in staff-owned files and a staff-owned table. Recommended.** `staff_refresh_tokens` (FK to `staff_members`), `StaffRefreshTokenDb` mirroring `RefreshTokenDb`, and the same rotation / atomic revoke-first / reuse-detection algorithm in `StaffAuthService`. Keeps the proven pattern without touching hardened athlete code. Cost: roughly 60 lines of near-duplicate logic; the shared `RefreshTokenHash` brand and `refreshTokenHash()` constructor are reused, only the random-bytes + SHA-256 two-liner is repeated in `StaffTokenService` (athlete `TokenService.createRefreshToken()` cannot be reused because it fixes the athlete TTL and returns an athlete-config expiry). Flag as a candidate for a later cleanup that extracts a generic refresh-token module once a third consumer appears.
2. Generalise now: parameterise `RefreshTokenDb`/`AuthService` by principal type (or a polymorphic `principal_id`). Removes duplication but modifies working, tested athlete code and widens this ticket's blast radius. Rejected for now.
3. Access token only (previous recommendation, 8 h). Superseded by the owner's decision.

Defaults: access TTL 900 s (15 min), refresh TTL 604_800 s (7 days); both env-configurable. Refresh "family" means all refresh tokens of that staff member, exactly as for athletes: reuse of a rotated token revokes all of that staff member's refresh tokens.

## 4. Design

### 4.1 Data model

New Prisma models (snake_case via `@map`, migration SQL uses mapped names).

`StaffMember`, table `staff_members`:

| Column | Type | Notes |
|---|---|---|
| `id` | text pk, `cuid()` | surfaces as `StaffId` |
| `name` | text | |
| `email` | text unique | stored as `NormalizedEmail` |
| `password_hash` | text | argon2id |
| `is_active` | boolean default true | deactivate instead of delete so `verified_by` ids stay resolvable |
| `tokens_valid_after` | timestamptz(3) null | access tokens issued before this instant are rejected |
| `created_at`, `updated_at` | timestamptz(3) | standard |

`StaffRefreshToken`, table `staff_refresh_tokens` (shape mirrors `refresh_tokens`): `id` cuid pk, `staff_id` FK to `staff_members`, `token_hash` unique, `expires_at`, `revoked_at` null, `created_at`, index on `staff_id`; back-relation `refreshTokens` on `StaffMember`.

No `role` column (D5 confirmed). `race_entries.verified_by` stays a plain string.

### 4.2 Units (`src/staff-auth/`)

Hexagonal split; no usecase layer (short orchestrations).

- `staff.db.ts`: the only ORM importer for `staff_members`. `findById`, `findByEmail` (with `passwordHash` typed `PasswordHash`), `create` (null on unique violation), `updatePassword(id, passwordHash, at)` and `deactivate(id, at)`. Each of the last two runs in one `$transaction` that updates the staff row (`tokensValidAfter = at`, plus `passwordHash` or `isActive=false`) AND revokes every active `staff_refresh_tokens` row of that staff member, so password change / deactivation can never leave a live refresh token. Returns `null` on missing row. Casts to brands here only.
- `staff-refresh-token.db.ts`: ORM access for `staff_refresh_tokens`: `create`, `findByHash`, `revokeIfActive(id)` (atomic `updateMany ... WHERE revoked_at IS NULL`, returns boolean), `revokeAllForStaff(staffId)`, `revokeByHash`. Mirrors `src/auth/refresh-token.db.ts` with `StaffId`.
- `staff.service.ts`: domain operations. `findActiveById`, `findByEmail`, `create` (`ConflictError('staff_email_taken')`), `setPassword`, `deactivate` (`NotFoundError('staff_not_found')`). Logs detail at throw sites.
- `staff-auth.config.ts`: reads `STAFF_JWT_SECRET`, `STAFF_JWT_TTL_SECONDS`, `STAFF_REFRESH_TOKEN_TTL_SECONDS`.
- `staff-token.service.ts`: `signAccessToken(staffId)`, `verifyAccessToken(token) -> { staffId, issuedAt }` (HS256 pinned, `STAFF_JWT_SECRET`, `aud: 'hyrox-staff'`, `iss: 'hyrox-api'`, failures log the reason and throw `UnauthorizedException('invalid_token')`, `sub` branded via `staffId()`); `createRefreshToken(): { token, hash, expiresAt }` (32 random bytes base64url, SHA-256 hex through `refreshTokenHash()`, staff refresh TTL); `hashRefreshToken(token)`.
- `staff-auth.service.ts`:
  - `login(email, password)`: normalise email; unknown email runs `verifyDummy`; unknown email, wrong password and deactivated account all return 401 `invalid_credentials` (uniform; detail logged); success issues tokens.
  - `refresh(refreshToken)`: same algorithm as `AuthService.refresh`: unknown -> 401 `invalid_refresh_token`; revoked -> `rejectReuse` (revoke all of the staff's tokens, 401); expired -> 401; `revokeIfActive` false -> `rejectReuse`; then re-load the staff row, and if missing or inactive -> 401 `invalid_refresh_token`; else issue a new pair, then re-load the staff row and, if it became inactive or its `tokens_valid_after` changed meanwhile (a concurrent set-password/deactivate), revoke all of the staff's tokens and return 401 `invalid_refresh_token`. (Deactivation already revoked the tokens in 4.1, so the re-check is defence in depth.)
  - `logout(refreshToken)`: `revokeByHash`, idempotent, always succeeds.
  - Private `issueTokens(staffId)` creates the access token and a persisted hashed refresh token. Responses: `{ accessToken, refreshToken, expiresIn, staff }` for login, `{ accessToken, refreshToken, expiresIn }` for refresh.
- `staff.guard.ts` (`StaffGuard`): extracts `Bearer`, `verifyAccessToken`, loads `StaffService.findActiveById`; rejects with `invalid_token` when the row is missing or inactive, or when `issuedAt <= floor(tokensValidAfter / 1000)` (seconds compare; a token minted in the same second as a reset is rejected, so a login in that exact second must be retried a second later). Sets `request.staffId`.
- `current-staff-id.decorator.ts`: `@CurrentStaffId()` returns `StaffId` and throws `UnauthorizedException('invalid_token')` when the guard did not run (fails closed; no `requireX` helper in handlers).
- `staff-auth.controller.ts`: `POST /staff/auth/login` (200, throttle 5/min/IP), `POST /staff/auth/refresh` (200, 10/min/IP, body `{ refreshToken }` via the existing `RefreshDto`), `POST /staff/auth/logout` (204, body `{ refreshToken }`, default throttle), `GET /staff/auth/me` (`StaffGuard`, returns `{ id, name, email }`).
- `dto/staff-login.dto.ts`: same validation as `LoginDto`.
- `staff-auth.module.ts`: imports `AuthModule` (exported `PasswordHasher`) and its own `JwtModule.registerAsync` with `STAFF_JWT_SECRET`; provides the above; exports `StaffGuard` and `StaffTokenService`.
- `src/auth/password-policy.ts` (new): `PASSWORD_MIN_LENGTH = 10`, `PASSWORD_MAX_LENGTH = 128` and `assertPasswordLength(plain): void` throwing `InvalidValueError('password_length_invalid')`. `SignupDto` is changed to use the constants in `@Length(...)` (no behaviour change); the CLI uses `assertPasswordLength`. This is the single source of the "same rules as athlete signup".
- `AuthModule`: add `PasswordHasher` to `exports`. `src/common/ids.ts`: move the `StaffId` type beside the other id types (cosmetic).

### 4.3 Consumer contract for HYR-33

```
@Controller('admin/race-entries')
@UseGuards(StaffGuard)
class ... { handler(@CurrentStaffId() reviewerId: StaffId, ...) }
```

`reviewerId` goes straight into `RaceEntryService.reviewVerification`. Staff-only controllers live under `/admin/*`. Mixed tokens fail with 401 `invalid_token` in both directions (tested).

### 4.4 Revocation semantics

- Access tokens (15 min): `StaffGuard` checks the row on every request (one PK read; staff traffic is tiny), so deactivation takes effect on the next request; `tokens_valid_after` kills tokens issued before a password change.
- Refresh tokens: `deactivate` and `set-password` revoke all of that staff member's refresh tokens in the same transaction as the row update (4.1). Logout revokes one token; reuse detection revokes all.
- Refresh rotation re-issues a fresh 7-day token each time, so an active user effectively has a sliding 7-day idle timeout with no absolute cap (same as athletes; see D11).

### 4.5 Account provisioning (D2, product-owner amended)

No signup endpoint, no HTTP staff-management API. An operator with server and DB access uses a CLI that boots a Nest application context (reuses `PasswordHasher`, `StaffService`, validated config):

```
npm run build
npm run staff -- create --email jane@example.com --name "Jane Doe" [--password "<pw>"]
npm run staff -- set-password --email jane@example.com [--password "<pw>"]
npm run staff -- deactivate --email jane@example.com
```

- `--password` is optional on `create` and `set-password`. When supplied it is validated with `assertPasswordLength` (10-128, same as athlete signup) and is NOT echoed back. When absent, a random 24-character password (`randomBytes(18)` base64url) is generated and printed once to stdout. Only the argon2id hash is stored.
- Accepted trade-off (owner decision, local machine only): a password passed with `--password` lands in shell history and the process list. The README states this and recommends omitting the flag on shared or production hosts. No other mitigation is built (no stdin/prompt mode; YAGNI).
- Failure: non-zero exit and the snake_case code on stdout/stderr. Parsing and output live in a pure, injectable `runStaffCommand(argv, { staffService, hasher, generatePassword, write })`; the entry file (`staff-admin.ts`) is bootstrap wiring only. The first staff account is created this way after deploy (README); no migration seeds credentials.

### 4.6 Config

New env: `STAFF_JWT_SECRET` (required, min 32), `STAFF_JWT_TTL_SECONDS` (int >= 1, default `900`), `STAFF_REFRESH_TOKEN_TTL_SECONDS` (int >= 1, default `604_800`). `validateEnv` also fails (`env_invalid`, with `staff_jwt_secret_must_differ_from_jwt_secret` logged) if `STAFF_JWT_SECRET === JWT_SECRET`. `.env.example` gets distinct local-dev values. Required so a deploy without it fails at boot instead of silently sharing a secret.

### 4.7 Throttling (D6)

Login 5/min/IP; refresh 10/min/IP (same as athletes); logout default (60/min). No per-account lockout (it would let an attacker lock reviewers out; argon2id plus generated passwords make guessing impractical, with the caveat that a user-supplied `--password` of only 10 characters is weaker, see D2). Shared-proxy-IP caveat until HYR-31.

### 4.8 Error codes

| Situation | Status | Code |
|---|---|---|
| unknown email, wrong password, deactivated (login) | 401 | `invalid_credentials` |
| missing/malformed header, bad signature, wrong audience/issuer, expired access token, athlete token, inactive/missing staff, token older than `tokens_valid_after` | 401 | `invalid_token` |
| unknown, expired, revoked or reused refresh token; staff missing/inactive on refresh | 401 | `invalid_refresh_token` |
| DTO failure | 400 | `validation_failed` |
| CLI: duplicate email | exit 1 | `staff_email_taken` |
| CLI: unknown staff | exit 1 | `staff_not_found` |
| CLI: supplied password length outside 10-128 | exit 1 | `password_length_invalid` |
| CLI: bad arguments | exit 1 | `args_invalid` |

No 403 in v1 (no roles).

## 5. Security notes

- Separate secret, audience and table; an athlete token cannot pass `StaffGuard` and a staff token cannot pass `JwtAuthGuard`.
- Pinned algorithm on verify; no `none`/alg confusion.
- Uniform login failure and dummy-hash verify prevent staff email enumeration and timing leaks.
- Refresh tokens are 256-bit random, stored only as SHA-256, rotated on use with revoke-first ordering, reuse revokes the whole set; never logged.
- Passwords never logged or returned; hash stays in `staff.db.ts` / `staff-auth.service.ts`.
- Residual risks accepted: stolen access token valid up to 15 min (shortened by the per-request row check on deactivation); stolen refresh token valid up to 7 days until used or revoked; no MFA; operator with DB access can mint accounts (by design); `--password` leaks to shell history (owner-accepted).

## 6. Testing

Vitest, nested `describe` per condition, short `it` titles, shared setup in `beforeEach`; `mockDeep<StaffDb>()` / `mockDeep<StaffRefreshTokenDb>()` for services.

- `staff-token.service.spec`: access sign/verify round trip; expired; wrong secret; wrong audience; wrong issuer; `alg: none`; missing/blank/non-string `sub`; `createRefreshToken` yields a base64url token whose hash is 64-hex and matches `hashRefreshToken`, with expiry from the staff refresh TTL; cross-token cases with real `JwtService`: an athlete `TokenService` token is rejected here and a staff token is rejected by athlete `TokenService.verifyAccessToken`.
- `staff-auth.service.spec`: login success (tokens persisted hashed, no hash in result); unknown email (dummy verify); wrong password; deactivated; email normalised. Refresh: success rotates (old revoked first, new persisted); unknown token; expired; already revoked (reuse -> `revokeAllForStaff`); lost atomic race (reuse); staff inactive or missing; response shape. Logout: revokes by hash, idempotent for unknown token.
- `staff.service.spec`, `staff.db.spec` (mocked Prisma, precedent `log-race.usecase.db.spec.ts`): unique violation returns `null`; `updatePassword`/`deactivate` run one transaction that sets `tokensValidAfter` and revokes active refresh tokens; missing row returns `null`. `staff-refresh-token.db.spec`: mirrors athlete db behaviour, `revokeIfActive` boolean.
- `staff.guard.spec`, `current-staff-id.decorator.spec`, `staff-auth.controller.spec` (login / refresh / logout delegate; `me`), `token-isolation.spec` (athlete vs staff guards, real JWT).
- `password-policy.spec` (9, 10, 128, 129 characters) and unchanged `signup.dto` behaviour; `env.validation.spec` (new vars, defaults 900 and `604_800`, equal secrets rejected); `run-staff-command.spec` (create / set-password with and without `--password`, supplied password too short / too long, never echoed, generated password printed once, duplicate, unknown, deactivate, bad args).
- Gates: `npx vitest run`, `npm run lint`, `npm run lint:arch`, `npm run build`.
- Manual e2e (qa-verifier): see plan Task 7.

## 7. Backend / frontend split

Backend-only. HYR-33 is the next consumer.

## 8. Decisions

- **D1 Identity source.** Recommend separate `staff_members` table.
- **D2 Account creation. DECIDED/AMENDED.** CLI only (create / set-password / deactivate). Optional `--password` validated with the athlete signup rule (10-128); otherwise generated and printed once. Shell-history leak accepted and documented in the README.
- **D3 Token model. DECIDED/CHANGED.** 15 min access JWT + 7 day opaque rotating refresh token with reuse detection, mirroring HYR-3 in staff-owned files/table (3.2). Both TTLs env-configurable.
- **D4 Token separation and hashing.** Recommend `STAFF_JWT_SECRET` distinct from `JWT_SECRET` (enforced at boot), `aud`/`iss`, reuse of the argon2id `PasswordHasher` via `AuthModule` export. Unchanged.
- **D5 Roles. DECIDED.** None. Every active staff member may use every `StaffGuard` route.
- **D6 Throttling.** Recommend login 5/min, refresh 10/min per IP, no per-account lockout.
- **D7 Routes.** `POST /staff/auth/{login,refresh,logout}`, `GET /staff/auth/me`, `/admin/*` for staff-only resources.
- **D8 Decorator shape.** `@CurrentStaffId()` throws 401 when absent, non-optional return type.
- **D9 Revocation.** `is_active` + `tokens_valid_after` for access tokens (checked per request); deactivate/set-password revoke refresh tokens transactionally.
- **D10 Env strictness.** `STAFF_JWT_SECRET` required and different from `JWT_SECRET`; existing dev `.env` files need the new variable.
- **D11 (new) Refresh-token duplication and absolute lifetime.** Recommend accepting the small duplication with the athlete flow (3.2, option 1) and, as for athletes, no absolute session cap beyond the sliding 7-day idle window. Alternatives: generalise refresh code now (touches hardened athlete code), or add an absolute cap column (`session_started_at` carried through rotation) if staff sessions must end after a fixed time.

Grill-me stress test was not run: this stage had no interactive user. Most worth a human challenge: D11 and the interaction of D2's user-chosen short passwords with D6's no-lockout stance.
