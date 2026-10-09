# Staff Authentication and Authorization (HYR-29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff accounts can log in, refresh and log out; `StaffGuard` and `@CurrentStaffId()` let later controllers (HYR-33) accept only active staff and receive a validated `StaffId`.

**Architecture:** New `src/staff-auth/` module following the hexagonal split (`staff.db.ts` and `staff-refresh-token.db.ts` are the only ORM importers; services own the rules). Separate `staff_members` and `staff_refresh_tokens` tables; 15 min access JWT signed with a distinct `STAFF_JWT_SECRET` plus `aud`/`iss`; 7 day opaque rotating refresh token with reuse detection mirroring the HYR-3 flow; per-request active-row and `tokens_valid_after` check in the guard. Accounts are managed by a CLI, not HTTP. Argon2id `PasswordHasher` is reused by exporting it from `AuthModule`.

**Tech Stack:** NestJS 12, `@nestjs/jwt` 12.0.2, Prisma 6.19.3, argon2 0.45.1, Vitest 5 with `vitest-mock-extended`. No new dependencies.

**Spec:** `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/hong-kong/docs/specs/2026-10-09-staff-auth-design.md`

**Decision gate:** Product owner has decided D2 (optional `--password`), D3 (access + refresh) and D5 (no roles). The coordinator should still confirm D1, D4, D6-D11 (spec section 8) before Task 1.

## Global Constraints

- Working directory `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/hong-kong`, branch `hyr-29` (already correctly named; do not rename after a PR exists).
- Backend-only. No `web/` or `shared/` change.
- Hexagonal: only `*.db.ts` imports `@prisma/client` or `src/prisma/`; services never do (`npm run lint:arch` enforces). `*.db.ts` returns `null`/`false`, no domain throws.
- Brand casts only in the two staff `*.db.ts` files and `src/common` constructors / the token service boundary via `staffId()` and `refreshTokenHash()`; no `as StaffId` elsewhere.
- Explicit return types on every function; no single-letter names; no inline `if`; blank line before `if`/`for`/`while`/`return`/`throw` unless first in block; `readonly` constructor parameter properties; numeric separators on literals of 5+ digits (`604_800`); no barrel files; no comments unless a non-obvious why.
- Error messages are snake_case codes; the readable detail goes to the class `Logger` at the throw site. Tokens, passwords and hashes are never logged.
- Prisma naming: snake_case tables/columns via `@map`/`@@map`; hand-written SQL uses mapped names.
- Dependency versions pinned exactly (none added here).
- Tests: Vitest, nested `describe` per condition (`when ...`), `it` titles state only the outcome, shared setup in the `describe`'s `beforeEach`. Service specs use `mockDeep<...Db>()`.
- Git: conventional commits (`feat(staff-auth): ...`). Do NOT commit: stage the work and stop for the user's `/crit` review. Commit footer when a commit is later made: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Plan gives signatures and test-case lists, not bodies; the builder writes the code test-first.
- Reuse athlete patterns by mirroring, not by modifying athlete auth code, except the two sanctioned edits: export `PasswordHasher` from `AuthModule`, and swap the literals in `SignupDto` for the shared password-length constants.

## File Structure

Create (under `src/staff-auth/` unless noted):
- `staff.db.ts`, `staff.db.spec.ts`: ORM access for `staff_members` (incl. transactional password/deactivate + refresh revocation).
- `staff-refresh-token.db.ts`, `staff-refresh-token.db.spec.ts`: ORM access for `staff_refresh_tokens`.
- `staff.service.ts`, `staff.service.spec.ts`.
- `staff-auth.config.ts`.
- `staff-token.service.ts`, `staff-token.service.spec.ts`.
- `public-staff.ts`.
- `staff-auth.service.ts`, `staff-auth.service.spec.ts`: login / refresh / logout.
- `staff.guard.ts`, `staff.guard.spec.ts`.
- `current-staff-id.decorator.ts`, `current-staff-id.decorator.spec.ts`.
- `dto/staff-login.dto.ts`.
- `staff-auth.controller.ts`, `staff-auth.controller.spec.ts`.
- `staff-auth.module.ts`.
- `token-isolation.spec.ts`.
- `cli/run-staff-command.ts`, `cli/run-staff-command.spec.ts`, `cli/staff-admin.ts`.
- `src/auth/password-policy.ts`, `src/auth/password-policy.spec.ts`.
- `prisma/migrations/20261009100000_add_staff_members/migration.sql`.

Modify:
- `prisma/schema.prisma` (add `StaffMember`, `StaffRefreshToken`).
- `src/auth/auth.module.ts` (export `PasswordHasher`), `src/auth/dto/signup.dto.ts` (use constants).
- `src/config/env.validation.ts`, `src/config/env.validation.spec.ts`.
- `src/common/prisma-error-codes.ts` (add `RECORD_NOT_FOUND = 'P2025'`).
- `src/app.module.ts` (import `StaffAuthModule`).
- `src/common/ids.ts` (move `StaffId` type beside the other id types).
- `.env.example`, `README.md`, `package.json` (script `staff`).

---

### Task 1: Config, password policy, ids tidy, AuthModule export

**Files:**
- Modify: `src/config/env.validation.ts`, `src/config/env.validation.spec.ts`, `src/auth/auth.module.ts`, `src/auth/dto/signup.dto.ts`, `src/common/ids.ts`, `src/common/prisma-error-codes.ts`, `.env.example`
- Create: `src/staff-auth/staff-auth.config.ts`, `src/auth/password-policy.ts`, `src/auth/password-policy.spec.ts`

**Interfaces:**
- Produces: `EnvironmentVariables.STAFF_JWT_SECRET: string` (required, min 32), `STAFF_JWT_TTL_SECONDS: number` (default `900`), `STAFF_REFRESH_TOKEN_TTL_SECONDS: number` (default `604_800`); `StaffAuthConfig` with `readonly jwtSecret: string`, `readonly accessTtlSeconds: number`, `readonly refreshTtlSeconds: number`; `PASSWORD_MIN_LENGTH = 10`, `PASSWORD_MAX_LENGTH = 128`, `assertPasswordLength(plain: string): void` (throws `InvalidValueError('password_length_invalid')`); `AuthModule` exports `PasswordHasher`; `RECORD_NOT_FOUND`.

- [ ] **Step 1: Write failing specs.** `password-policy.spec.ts`: `when the password has 9 characters` throws `password_length_invalid`; `when it has 10` passes; `when it has 128` passes; `when it has 129` throws. `env.validation.spec.ts`: add `STAFF_JWT_SECRET` (a different 32-char string) to `validEnv`, then `when STAFF_JWT_SECRET is missing` throws `env_invalid`; `when it is shorter than 32 characters` throws; `when it equals JWT_SECRET` throws `env_invalid` and logs `staff_jwt_secret_must_differ_from_jwt_secret`; `when STAFF_JWT_TTL_SECONDS is absent` defaults to `900`; `when it is '3600'` parses to `3600`; `when STAFF_REFRESH_TOKEN_TTL_SECONDS is absent` defaults to `604_800`; `when it is set` it parses.
- [ ] **Step 2: Run** `npx vitest run src/config/env.validation.spec.ts src/auth/password-policy.spec.ts`. Expected: new cases FAIL.
- [ ] **Step 3: Implement** the env fields (same decorator style as the athlete ones, constants `DEFAULT_STAFF_ACCESS_TTL_SECONDS = 900`, `DEFAULT_STAFF_REFRESH_TTL_SECONDS = 604_800`), the equality check in `validateEnv` (log through `new Logger('Env').error(...)`, throw `Error('env_invalid')`), `password-policy.ts`, and `StaffAuthConfig` (`@Injectable`, mirrors `src/auth/auth.config.ts`). Change `SignupDto` to `@Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)`; add `PasswordHasher` to `AuthModule.exports`; move the `StaffId` type next to the other id types in `ids.ts`; add `RECORD_NOT_FOUND` to `prisma-error-codes.ts`.
- [ ] **Step 4: Update `.env.example`**: `STAFF_JWT_SECRET=local-dev-only-staff-jwt-secret-0123456789-xyz` (must differ from `JWT_SECRET`), `STAFF_JWT_TTL_SECONDS=900`, `STAFF_REFRESH_TOKEN_TTL_SECONDS=604800`. Note for the executor: existing local `.env` files must get the new variables or the app will not boot (intended fail-closed).
- [ ] **Step 5: Run** `npx vitest run src/config src/common src/auth` and `npx tsc --noEmit -p tsconfig.json`. Expected: PASS (existing signup/auth specs unchanged and green).
- [ ] **Step 6: Stage** (`git add` the files above). No commit.

### Task 2: Schema, migration, `StaffDb`, `StaffRefreshTokenDb`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261009100000_add_staff_members/migration.sql`, `src/staff-auth/staff.db.ts`, `staff.db.spec.ts`, `staff-refresh-token.db.ts`, `staff-refresh-token.db.spec.ts`

**Interfaces:**
- Consumes: `StaffId`, `NormalizedEmail`, `PasswordHash`, `RefreshTokenHash`, `PrismaService`, `UNIQUE_VIOLATION`, `RECORD_NOT_FOUND`.
- Produces:
  - `type StaffRow = StaffMember & { id: StaffId; email: NormalizedEmail; passwordHash: PasswordHash }`
  - `StaffDb.findById(id: StaffId): Promise<StaffRow | null>`
  - `StaffDb.findByEmail(email: NormalizedEmail): Promise<StaffRow | null>`
  - `StaffDb.create(data: { name: string; email: NormalizedEmail; passwordHash: PasswordHash }): Promise<StaffRow | null>` (null on unique violation)
  - `StaffDb.updatePassword(id: StaffId, passwordHash: PasswordHash, at: Date): Promise<StaffRow | null>` (single `$transaction`: set `passwordHash` and `tokensValidAfter = at`, then revoke all non-revoked `staff_refresh_tokens` of the staff; null when no such row)
  - `StaffDb.deactivate(id: StaffId, at: Date): Promise<StaffRow | null>` (same transaction shape: `isActive=false`, `tokensValidAfter = at`, revoke all refresh tokens; null when no such row)
  - `type StaffRefreshTokenRecord = StaffRefreshToken & { staffId: StaffId }`
  - `StaffRefreshTokenDb.create(data: { staffId: StaffId; tokenHash: RefreshTokenHash; expiresAt: Date }): Promise<StaffRefreshToken>`
  - `StaffRefreshTokenDb.findByHash(tokenHash: RefreshTokenHash): Promise<StaffRefreshTokenRecord | null>`
  - `StaffRefreshTokenDb.revokeIfActive(id: string): Promise<boolean>` (atomic `updateMany ... revokedAt: null`, true when count is 1)
  - `StaffRefreshTokenDb.revokeAllForStaff(staffId: StaffId): Promise<void>`
  - `StaffRefreshTokenDb.revokeByHash(tokenHash: RefreshTokenHash): Promise<void>`

- [ ] **Step 1: Write failing `staff.db.spec.ts`** with `mockDeep<PrismaService>()` (pattern: `src/races/usecases/log-race/log-race.usecase.db.spec.ts`). Cases: `findById`/`findByEmail` query `staffMember.findUnique`; `when create hits a unique violation` returns `null`; `when create hits another error` rethrows; `updatePassword` runs one `$transaction` that sets `tokensValidAfter: at` and revokes active refresh tokens; `deactivate` sets `isActive: false` and revokes; `when the row does not exist` (`P2025`) both return `null`.
- [ ] **Step 2: Write failing `staff-refresh-token.db.spec.ts`**, mirroring behavior of `src/auth/refresh-token.db.ts`: `create` passes data through; `findByHash` queries by hash and returns `null` when absent; `revokeIfActive` filters `revokedAt: null` and returns `true` for count 1, `false` for 0; `revokeAllForStaff` and `revokeByHash` only touch non-revoked rows.
- [ ] **Step 3: Edit `schema.prisma`**: add `model StaffMember` and `model StaffRefreshToken` per spec 4.1 (`@@map("staff_members")` / `@@map("staff_refresh_tokens")`, mapped columns, `@db.Timestamptz(3)`, unique `email` and `token_hash`, `@@index([staffId])`, relation + back-relation).
- [ ] **Step 4: Generate the migration**: with the dev DB up (`docker compose up -d`, port 5435) run `npx prisma migrate dev --name add_staff_members`; rename the directory to `20261009100000_add_staff_members` if the timestamp differs; confirm the SQL creates only the two tables, the two unique indexes, the `staff_id` index and the FK. Run `npx prisma generate`.
- [ ] **Step 5: Run** both specs. Expected: FAIL (no implementation).
- [ ] **Step 6: Implement** both db classes (`@Injectable`, `constructor(private readonly prisma: PrismaService)`), the only staff files importing `@prisma/client`, casting rows to their branded record types.
- [ ] **Step 7: Run** the specs again plus `npm run lint:arch`. Expected: PASS, no violations.
- [ ] **Step 8: Stage.** No commit.

### Task 3: `StaffService` and `StaffTokenService`

**Files:**
- Create: `src/staff-auth/staff.service.ts`, `staff.service.spec.ts`, `staff-token.service.ts`, `staff-token.service.spec.ts`

**Interfaces:**
- Consumes: `StaffDb`/`StaffRow` (Task 2), `StaffAuthConfig` (Task 1), `staffId()`, `refreshTokenHash()`, `ConflictError`/`NotFoundError`.
- Produces:
  - `StaffService.findActiveById(id: StaffId): Promise<StaffRow | null>` (null when missing or inactive)
  - `StaffService.findByEmail(email: NormalizedEmail): Promise<StaffRow | null>`
  - `StaffService.create(input: { name: string; email: NormalizedEmail; passwordHash: PasswordHash }): Promise<StaffRow>` (throws `ConflictError('staff_email_taken')`)
  - `StaffService.setPassword(email: NormalizedEmail, passwordHash: PasswordHash): Promise<void>` (throws `NotFoundError('staff_not_found')`)
  - `StaffService.deactivate(email: NormalizedEmail): Promise<void>` (throws `NotFoundError('staff_not_found')`)
  - `StaffTokenService.signAccessToken(id: StaffId): Promise<string>`
  - `StaffTokenService.verifyAccessToken(token: string): Promise<{ staffId: StaffId; issuedAt: number }>` (`issuedAt` in seconds; throws `UnauthorizedException('invalid_token')`)
  - `StaffTokenService.get accessTtlSeconds(): number`
  - `type CreatedStaffRefreshToken = { token: string; hash: RefreshTokenHash; expiresAt: Date }`
  - `StaffTokenService.createRefreshToken(): CreatedStaffRefreshToken` (32 random bytes base64url, SHA-256 hex, expiry from `STAFF_REFRESH_TOKEN_TTL_SECONDS`)
  - `StaffTokenService.hashRefreshToken(token: string): RefreshTokenHash`

- [ ] **Step 1: Write failing `staff.service.spec.ts`** (`Test.createTestingModule`, `mockDeep<StaffDb>()`; spy `Logger.prototype.warn`). Cases: `findActiveById` returns row when active; `when the staff is inactive` returns `null`; `when the staff is missing` returns `null`; `create` returns the row; `when the email is already taken` throws `staff_email_taken` and logs; `setPassword`/`deactivate` look up by email and call the db with the row id and a `Date`; `when no staff has that email` both throw `staff_not_found` and log; `when the db returns null mid-operation` throws `staff_not_found`.
- [ ] **Step 2: Write failing `staff-token.service.spec.ts`** using a real `JwtService` with the staff secret and a second real `JwtService` with a different secret for cross-token cases. Cases: `when the token is valid` round-trips id and numeric `issuedAt`, payload has `aud='hyrox-staff'`, `iss='hyrox-api'`; `when the token is expired` throws `invalid_token`; `when signed with another secret` (including a token from athlete `TokenService.signAccessToken`) throws; `when the audience is wrong` throws; `when the issuer is wrong` throws; `when alg is none` throws; `when sub is missing, blank or not a string` throws. Cross-direction: a staff token passed to athlete `TokenService.verifyAccessToken` throws `invalid_token`. Refresh: `createRefreshToken` returns distinct base64url tokens on successive calls, a 64-hex hash equal to `hashRefreshToken(token)`, and `expiresAt` about `now + refreshTtlSeconds` (fake timers).
- [ ] **Step 3: Run** both specs. Expected: FAIL.
- [ ] **Step 4: Implement** `StaffService` (`Logger(StaffService.name)`, logs ids at each throw) and `StaffTokenService` (HS256 pinned on sign and verify; `audience`/`issuer`; `staffId()` on `sub` with `InvalidValueError` mapped to `invalid_token`; reason logged via `warn`, never the token; refresh generation via `randomBytes`/`createHash`, branded with `refreshTokenHash()`).
- [ ] **Step 5: Run** both specs. Expected: PASS.
- [ ] **Step 6: Stage.** No commit.

### Task 4: `StaffAuthService` (login, refresh, logout)

**Files:**
- Create: `src/staff-auth/staff-auth.service.ts`, `staff-auth.service.spec.ts`, `public-staff.ts`, `dto/staff-login.dto.ts`

**Interfaces:**
- Consumes: `StaffService.findByEmail`/`findActiveById`, `StaffTokenService.*` (Task 3), `StaffRefreshTokenDb.*` (Task 2), `PasswordHasher.verify`/`verifyDummy`, `normalizeEmail`.
- Produces:
  - `type PublicStaff = { id: StaffId; name: string; email: string }`, `toPublicStaff(row: StaffRow): PublicStaff` in `public-staff.ts`
  - `type StaffAuthTokens = { accessToken: string; refreshToken: string; expiresIn: number }`
  - `type StaffLoginResult = StaffAuthTokens & { staff: PublicStaff }`
  - `StaffAuthService.login(input: { email: string; password: string }): Promise<StaffLoginResult>`
  - `StaffAuthService.refresh(refreshToken: string): Promise<StaffAuthTokens>`
  - `StaffAuthService.logout(refreshToken: string): Promise<void>`
  - `StaffLoginDto { email; password }` with the same validators as `src/auth/dto/login.dto.ts`

- [ ] **Step 1: Write failing spec** (mock `StaffService`, `StaffTokenService`, `StaffRefreshTokenDb`, `PasswordHasher`). Login: `when credentials are valid` returns tokens + public staff, persists a refresh token row (hash and expiry from the token service), result has no `passwordHash`; `when the email is mixed case or padded` lookup uses the normalised email; `when the email is unknown` calls `verifyDummy` and throws `UnauthorizedException('invalid_credentials')`; `when the password is wrong` throws and does not sign; `when the account is inactive` verifies the password then throws `invalid_credentials` and signs nothing; each failure logs a warn. Refresh: `when the token is valid` revokes it first (`revokeIfActive`) then issues and persists a new pair; `when the token is unknown` throws `invalid_refresh_token`; `when the token is expired` throws `invalid_refresh_token` and does not revoke-all; `when the token was already revoked` calls `revokeAllForStaff` and throws `invalid_refresh_token`; `when revokeIfActive returns false` (lost race) treated as reuse; `when the staff is inactive or missing` throws `invalid_refresh_token`; logs never contain the token. Logout: `revokeByHash` called with the hash; unknown token resolves without error.
- [ ] **Step 2: Run** `npx vitest run src/staff-auth/staff-auth.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `StaffAuthService` following the algorithm and ordering in `src/auth/auth.service.ts` (revoke-first, `rejectReuse` private helper, private `issueTokens(staffId)`), `public-staff.ts`, and the DTO.
- [ ] **Step 4: Run** the spec. Expected: PASS.
- [ ] **Step 5: Stage.** No commit.

### Task 5: `StaffGuard`, `@CurrentStaffId()`, controller, module wiring

**Files:**
- Create: `src/staff-auth/staff.guard.ts`, `staff.guard.spec.ts`, `current-staff-id.decorator.ts`, `current-staff-id.decorator.spec.ts`, `staff-auth.controller.ts`, `staff-auth.controller.spec.ts`, `staff-auth.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `StaffTokenService.verifyAccessToken`, `StaffService.findActiveById` (Task 3), `StaffAuthService.login/refresh/logout`, `toPublicStaff` (Task 4), `RefreshDto` (`src/auth/dto/refresh.dto.ts`), `PasswordHasher` export (Task 1).
- Produces:
  - `type StaffAuthenticatedRequest = Request & { staffId?: StaffId }`
  - `StaffGuard implements CanActivate` (provided and exported by `StaffAuthModule`)
  - `CurrentStaffId` parameter decorator returning `StaffId`; wraps an exported plain function `extractStaffId(context: ExecutionContext): StaffId` that throws `UnauthorizedException('invalid_token')` when absent
  - `POST /staff/auth/login` -> `StaffLoginResult` (200, `@Throttle({ default: { limit: 5, ttl: 60_000 } })`)
  - `POST /staff/auth/refresh` -> `StaffAuthTokens` (200, `@Throttle({ default: { limit: 10, ttl: 60_000 } })`, body `RefreshDto`)
  - `POST /staff/auth/logout` -> 204 (body `RefreshDto`)
  - `GET /staff/auth/me` (`@UseGuards(StaffGuard)`) -> `PublicStaff`
  - `StaffAuthModule` with `exports: [StaffGuard, StaffTokenService]`

- [ ] **Step 1: Write failing `staff.guard.spec.ts`** modelled on `src/auth/jwt-auth.guard.spec.ts` (`contextFor` helper, `mockDeep` collaborators, spy `Logger.prototype.warn`). Cases: `when the header is missing` throws `invalid_token`; `when the scheme is not Bearer` throws; `when the token is invalid` rethrows `invalid_token`; `when the staff row is missing` throws; `when the staff is inactive` throws; `when the token was issued before tokensValidAfter` (`issuedAt` seconds at or below `floor(tokensValidAfter/1000)`) throws; `when tokensValidAfter is null` allows; `when issuedAt is in the same second as tokensValidAfter` throws; `when issuedAt is the second after` allows; `when the token is valid and the staff is active` returns true and sets `request.staffId`.
- [ ] **Step 2: Write failing decorator spec** against `extractStaffId`: returns the id when present; throws `invalid_token` when absent.
- [ ] **Step 3: Write failing controller spec**: `login` delegates and returns the result; `refresh` delegates with `dto.refreshToken`; `logout` delegates and resolves void; `me` loads the active staff by current id and returns the public shape; `when the staff row has vanished` throws `invalid_token`.
- [ ] **Step 4: Run** the three specs. Expected: FAIL.
- [ ] **Step 5: Implement** guard, decorator, controller, module (`imports: [AuthModule, JwtModule.registerAsync(... STAFF_JWT_SECRET ...)]`; providers `StaffAuthConfig, StaffDb, StaffRefreshTokenDb, StaffService, StaffTokenService, StaffAuthService, StaffGuard`; controller registered; exports as above). Add `StaffAuthModule` to `AppModule.imports`.
- [ ] **Step 6: Run** `npx vitest run src/staff-auth` and `npx tsc --noEmit -p tsconfig.json`. Expected: PASS. Boot check: `npm run build && node dist/main.js` with the new env set; expect Nest to log the four `/staff/auth/*` routes and no DI errors; stop the process.
- [ ] **Step 7: Stage.** No commit.

### Task 6: Cross-guard integration test

**Files:**
- Create: `src/staff-auth/token-isolation.spec.ts`

**Interfaces:**
- Consumes: real `JwtAuthGuard` + athlete `TokenService` (`JWT_SECRET`), real `StaffGuard` + `StaffTokenService` (`STAFF_JWT_SECRET`), `mockDeep<StaffService>` returning an active row.

- [ ] **Step 1: Write the spec** wiring both guard stacks with real `JwtService` instances and two different secrets. Cases: `when an athlete token is presented to StaffGuard` rejects with `invalid_token`; `when a staff token is presented to JwtAuthGuard` rejects with `invalid_token`; `when each guard gets its own token type` accepts and sets `staffId` / `athleteId` respectively.
- [ ] **Step 2: Run** `npx vitest run src/staff-auth/token-isolation.spec.ts`. Expected: PASS immediately (behavior exists from Tasks 3 and 5). If it fails, fix the cause, not the test.
- [ ] **Step 3: Stage.** No commit.

### Task 7: Operator CLI, README, final gates, manual E2E

**Files:**
- Create: `src/staff-auth/cli/run-staff-command.ts`, `run-staff-command.spec.ts`, `staff-admin.ts`
- Modify: `package.json` (scripts), `README.md`

**Interfaces:**
- Consumes: `StaffService.create/setPassword/deactivate`, `PasswordHasher.hash`, `normalizeEmail`, `assertPasswordLength` (Task 1), `DomainError` (`.code`).
- Produces: `runStaffCommand(argv: string[], deps: { staffService: StaffService; hasher: PasswordHasher; generatePassword: () => string; write: (line: string) => void }): Promise<number>` returning the exit code. Commands: `create --email <e> --name <n> [--password <pw>]`, `set-password --email <e> [--password <pw>]`, `deactivate --email <e>`. Parse with `node:util` `parseArgs`. `staff-admin.ts` calls `NestFactory.createApplicationContext(AppModule, { logger: ['error'] })`, resolves the providers, passes `randomBytes(18).toString('base64url')` as the generator and `process.stdout.write`, closes the context, sets `process.exitCode`.

- [ ] **Step 1: Write failing `run-staff-command.spec.ts`**. Cases: `when creating staff without --password` generates one, hashes it, calls `create` with the normalised email and hash, writes the password exactly once, returns `0`; `when creating staff with --password` hashes the supplied value, does not call the generator, does not write the password back, returns `0`; `when the supplied password has 9 or 129 characters` returns `1` with `password_length_invalid` and calls no service; `when the email is taken` returns `1` with `staff_email_taken`; `set-password` with and without `--password` behaves the same way and calls `setPassword`; `when staff is unknown` returns `1` with `staff_not_found`; `deactivate` calls `deactivate`, returns `0`, writes no password; `deactivate` ignores/rejects `--password` with `args_invalid`; `when --email is missing` or the command is unknown returns `1` with `args_invalid`; `when the email is malformed` returns `1` with `email_invalid`.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** `run-staff-command.ts` and the thin `staff-admin.ts`. Add `"staff": "node dist/staff-auth/cli/staff-admin.js"` to `package.json` scripts (verify the emitted path after the build; adjust if `tsconfig.build.json` lays out differently).
- [ ] **Step 4: README.** Add a "Staff accounts (HYR-29)" section: build first; the three commands with the optional `--password`; password is printed once only when generated; the `--password` flag leaves the password in shell history and the process list (accepted for local use; omit it on shared or production hosts); 15 min access + 7 day rotating refresh model and endpoints; the `/admin/*` + `StaffGuard` + `@CurrentStaffId()` convention for HYR-33; the new env vars.
- [ ] **Step 5: Run all gates**: `npx vitest run`, `npm run lint`, `npm run lint:arch`, `npm run build`. Expected: all green.
- [ ] **Step 6: Manual end-to-end (hand to qa-verifier; record results in the PR)**. Start the dev DB and `node dist/main.js`, then:
  1. `npm run staff -- create --email qa@example.com --name "QA"`; note the generated password. Repeat with `--email qa2@example.com --name "QA2" --password "short"` and expect exit 1 `password_length_invalid`; then with a valid 12-character `--password` and expect exit 0 and no password echoed.
  2. `POST /staff/auth/login` with the credentials: 200 with `accessToken`, `refreshToken`, `expiresIn: 900`, `staff`.
  3. `GET /staff/auth/me` with the access token: 200. The same staff access token on `GET /auth/me`: 401 `invalid_token`. An athlete access token (from `/auth/signup`) on `GET /staff/auth/me`: 401 `invalid_token`.
  4. `POST /staff/auth/refresh` with the refresh token: 200 and a new pair. Re-send the OLD refresh token: 401 `invalid_refresh_token`, and the NEW refresh token is now also rejected (reuse revoked the set).
  5. Log in again; `POST /staff/auth/logout` with that refresh token: 204; refreshing with it: 401.
  6. Wrong password: 401 `invalid_credentials`. Six rapid bad logins: 429.
  7. Log in, then `npm run staff -- deactivate --email qa@example.com`: the old access token on `/staff/auth/me` is 401, the old refresh token is 401, and login is 401 `invalid_credentials`.
  8. With another active user: log in, run `set-password`, then confirm the old access token and refresh token are both 401 and the new password logs in.
- [ ] **Step 7: Stage everything and stop.** Tell the user the work is staged and they can run `/crit` to review; do not commit until they respond. Linear: move HYR-29 to In Progress at start (check current state first) and to In Review only once staged.

---

## Self-Review

- Spec coverage: data model with both tables (T2), password policy and env (T1), db / service / token / login / refresh / logout (T2-T4), guard / decorator / controller / module (T5), transactional revocation on deactivate and set-password (T2 db, verified T7 E2E steps 7-8), isolation (T3, T6), CLI with optional `--password` and README shell-history note (T7), throttling (T5), error codes (T1, T3-T5, T7). Non-goals have no tasks.
- Placeholder scan: none; steps are specified by signatures and exhaustive test-case lists instead of code, per the dispatch instruction. No roles task remains.
- Type consistency: `StaffRow`, `StaffRefreshTokenRecord`, `PublicStaff`, `StaffAuthTokens`, `StaffLoginResult`, `StaffAuthenticatedRequest`, method names and error codes (`staff_email_taken`, `staff_not_found`, `invalid_token`, `invalid_credentials`, `invalid_refresh_token`, `password_length_invalid`, `args_invalid`) are used identically across tasks. `issuedAt` is seconds in T3 and compared (`<=`) with `floor(tokensValidAfter / 1000)` in T5.

## Parallelism

Backend-only, sequential: T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7. T1 and T2 touch disjoint files except `prisma-error-codes.ts` (T1 adds the constant T2 consumes), so run T1 first. No frontend work; dispatch `backend-builder` only.
