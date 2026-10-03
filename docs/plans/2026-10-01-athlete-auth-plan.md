# HYR-3: Athlete Signup/Auth + 18+ Self-Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Athletes can sign up (rejected without 18+ self-attestation), log in, refresh, log out, and call a guarded `GET /auth/me`, using argon2id passwords, short-lived access JWTs and rotating hashed refresh tokens.

**Architecture:** New `auth/` module (controller, `AuthService`, `TokenService`, `PasswordHasher`, `RefreshTokenDb`, guard) layered over `athletes/`, which stays the sole owner of athlete reads/writes and enforces the attestation invariant. Hexagonal split throughout; no usecase layer. Platform hardening (ValidationPipe, CORS, throttler) deferred from HYR-2 lands in the last task.

**Tech Stack:** NestJS 12 (ESM), Prisma 6.19.3, Postgres (port 5435), Vitest 5 + vitest-mock-extended, argon2, @nestjs/jwt, @nestjs/throttler, class-validator, class-transformer.

**Spec:** `docs/specs/2026-10-01-athlete-auth-design.md`

## Global Constraints

- Every dependency pinned to an exact version: install, then rewrite package.json without `^`/`~` from `package-lock.json`. Expected: `argon2` 0.45.1, `@nestjs/jwt` 12.0.2, `@nestjs/throttler` 6.7.1, `class-validator` 0.15.1, `class-transformer` 0.5.1 (use the lockfile value if it differs).
- Native ESM: every relative import carries an explicit `.js` extension. No barrel files; import the specific file everywhere, including `src/common`.
- Explicit return types on every function/method (eslint `explicit-function-return-type: error`). No single-letter variables (except `i`/`j`/`k` in indexed `for`). No inline `if`; blank line before `if`/`for`/`while`/`return`/`throw` unless first in block. No nested function declarations. No `!!x`. Constructor-injected deps are `private readonly`.
- Hexagonal: `*.service.ts` never imports `@prisma/client`, `argon2` is imported only by `src/auth/password-hasher.ts`, Prisma only by `*.db.ts`. `npm run lint:arch` must stay green. Services must not import Prisma enums or `src/prisma/`.
- Errors are snake_case codes (`new BadRequestException('email_already_registered')`); readable detail with ids goes to a per-class `private readonly logger = new Logger(X.name)` at the throw site (`warn`). Never log passwords, tokens or hashes. `src/common` helpers throw plain `Error` with only a snake_case code and never log.
- Brand casts only at I/O boundaries: `*.db.ts` ORM reads and the `PasswordHasher` adapter; services never cast.
- Prisma: snake_case `@map`/`@@map`, every DateTime `@db.Timestamptz(3)`, raw SQL uses mapped names.
- Comments only for a genuinely non-obvious why. Delete dead code.
- Tests (Vitest, globals on): `Test.createTestingModule` + `{ provide: XDb, useValue: mockDeep<XDb>() }`, `moduleRef.get(X)`. Nest a `describe('when ...')` per condition; `it` titles state only the outcome; shared setup in that describe's `beforeEach`.
- Commits: Conventional Commits (`type(scope): lowercase imperative`), end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage and stop before the final commit if the user wants to `/crit` first (global git rule); intermediate task commits are fine on the feature branch. Branch should be named `hyr-03` (rename before any push/PR).
- Run from `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/houston`. Local DB: Postgres on host port 5435 (`docker-compose up -d`); never touch other projects' containers.

---

## File Structure

```
prisma/schema.prisma                         modify: Athlete.passwordHash, RefreshToken model
prisma/migrations/<ts>_add_athlete_auth/     create: migration + hand-written CHECK
src/common/password-hash.ts (+ .spec.ts)     create: PasswordHash brand + constructor
src/common/refresh-token-hash.ts (+ .spec)   create: RefreshTokenHash brand + constructor
src/common/validation-pipe.ts (+ .spec.ts)   create: createValidationPipe()
src/athletes/athlete.db.ts                   modify: findByEmail, create
src/athletes/athlete.service.ts (+ .spec)    modify: findByEmail, register
src/athletes/public-athlete.ts (+ .spec.ts)  create: PublicAthlete + toPublicAthlete
src/auth/auth.config.ts                      create: AuthConfig (injectable facade over ConfigService)
src/config/env.validation.ts (+ .spec.ts)    create: EnvironmentVariables, validateEnv (boot-time validation)
src/auth/password-hasher.ts (+ .spec.ts)     create: argon2 adapter
src/auth/token.service.ts (+ .spec.ts)       create: JWT sign/verify, refresh token generate/hash
src/auth/refresh-token.db.ts                 create: refresh_tokens access
src/auth/auth.service.ts (+ .spec.ts)        create: signup/login/refresh/logout
src/auth/dto/signup.dto.ts login.dto.ts refresh.dto.ts   create
src/auth/jwt-auth.guard.ts (+ .spec.ts)      create
src/auth/current-athlete-id.decorator.ts        create
src/auth/auth.controller.ts                  create
src/auth/auth.module.ts                      create
src/app.module.ts                            modify: AuthModule, ThrottlerModule, APP_GUARD
src/main.ts                                  modify: ValidationPipe, CORS
.env.example, README.md                       modify
```

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (Athlete model; add RefreshToken)
- Create: `prisma/migrations/<timestamp>_add_athlete_auth/migration.sql`

**Interfaces:**
- Produces: Prisma `Athlete.passwordHash: string`; `Athlete.refreshTokens`; model `RefreshToken { id, athleteId, tokenHash (unique), expiresAt, revokedAt?, createdAt }` accessed as `prisma.refreshToken`.

- [ ] **Step 1: Edit the schema.** Add to `Athlete` after `email`: `passwordHash String @map("password_hash")`, and relation `refreshTokens RefreshToken[]`. Add:

```prisma
model RefreshToken {
  id        String    @id @default(cuid())
  athleteId String    @map("athlete_id")
  tokenHash String    @unique @map("token_hash")
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  athlete Athlete @relation(fields: [athleteId], references: [id])

  @@index([athleteId])
  @@map("refresh_tokens")
}
```

- [ ] **Step 2: Generate the migration without applying.** Start the DB (`docker-compose up -d`), then `npx prisma migrate dev --name add_athlete_auth --create-only`. If it complains about existing rows, run `npx prisma migrate reset` first (dev DB only).
- [ ] **Step 3: Append the hand-written CHECK** to the generated `migration.sql`, with a `-- Hand-written` comment like the init migration:

```sql
ALTER TABLE "athletes"
  ADD CONSTRAINT "athletes_adult_attestation_consistent"
  CHECK (is_adult = false OR adult_attested_at IS NOT NULL);
```

- [ ] **Step 4: Apply and verify.** `npx prisma migrate dev`, then `npx prisma generate`. Verify the constraint with psql on port 5435: inserting an athlete with `is_adult = true` and null `adult_attested_at` must fail with `athletes_adult_attestation_consistent`.
- [ ] **Step 5: Commit** `feat(db): add athlete password hash, refresh tokens and attestation check`.

---

### Task 2: Dependencies, brands and auth config

**Files:**
- Modify: `package.json`, `package-lock.json`, `.env.example`
- Create: `src/common/password-hash.ts`, `src/common/refresh-token-hash.ts`, `src/auth/auth.config.ts`
- Test: `src/common/password-hash.spec.ts`, `src/common/refresh-token-hash.spec.ts`, `src/config/env.validation.spec.ts`

**Interfaces:**
- Produces:
  - `type PasswordHash = Brand<string, 'PasswordHash'>`; `passwordHash(raw: string): PasswordHash` (throws `Error('password_hash_invalid')` unless it starts with `$argon2id$`).
  - `type RefreshTokenHash = Brand<string, 'RefreshTokenHash'>`; `refreshTokenHash(raw: string): RefreshTokenHash` (throws `Error('refresh_token_hash_invalid')` unless `/^[0-9a-f]{64}$/`).
  - `validateEnv(raw): EnvironmentVariables` in `src/config/env.validation.ts` (class-validator; wired via `ConfigModule.forRoot({ validate })` so the app refuses to boot; logs the invalid variable names, throws `Error('env_invalid')`; `JWT_SECRET` min 32 chars, TTLs positive integers, defaults 900 and 2592000). `@Injectable() class AuthConfig` (readonly `jwtSecret`, `accessTtlSeconds`, `refreshTtlSeconds`, read from `ConfigService`).

- [ ] **Step 1: Install deps.** `npm install argon2 @nestjs/jwt @nestjs/throttler @nestjs/config class-validator class-transformer`, then rewrite the six package.json entries to exact versions from the lockfile. Confirm `npm run build` still passes.
- [ ] **Step 2: Write failing specs** (plain Vitest, no Nest), nested by condition:
  - `passwordHash`: `describe('when the value starts with $argon2id$')` -> `it('returns it')`; `describe('when it does not')` -> `it('throws password_hash_invalid')`.
  - `refreshTokenHash`: valid 64-hex returns the value; wrong length and uppercase/non-hex throw `refresh_token_hash_invalid`.
  - `validateEnv`: `describe('when env is valid')` returns parsed config; `describe('when TTLs are unset')` returns 900 / 2592000; `describe('when JWT_SECRET is shorter than 32 chars')` throws `env_invalid`; `describe('when JWT_SECRET is missing')` same; `describe('when a TTL is not a positive integer')` throws `env_invalid`.
- [ ] **Step 3: Run** `npx vitest run src/common src/config/env.validation.spec.ts`; expect FAIL (modules missing).
- [ ] **Step 4: Implement** the three files per the interfaces above. Brand type comes from `./brand.js`.
- [ ] **Step 5: Run the same command;** expect PASS. Add to `.env.example`: `JWT_SECRET=` (comment-free placeholder of 32+ chars for local dev), `JWT_ACCESS_TTL_SECONDS=900`, `REFRESH_TOKEN_TTL_SECONDS=2592000`, `CORS_ORIGINS=http://localhost:5173`.
- [ ] **Step 6: Commit** `feat(auth): add auth dependencies, branded hash types and env validation`.

---

### Task 3: PasswordHasher adapter

**Files:**
- Create: `src/auth/password-hasher.ts`
- Test: `src/auth/password-hasher.spec.ts`

**Interfaces:**
- Consumes: `passwordHash` from `../common/password-hash.js`.
- Produces: `@Injectable() class PasswordHasher implements OnModuleInit` with
  - `hash(plain: string): Promise<PasswordHash>` (argon2id, library defaults)
  - `verify(hash: PasswordHash, plain: string): Promise<boolean>` (returns false on mismatch; never throws on a well-formed hash)
  - `verifyDummy(plain: string): Promise<void>` (runs a verify against a hash created in `onModuleInit`, result discarded; equalises timing for unknown emails)

- [ ] **Step 1: Failing spec** (real argon2, no mocks; a few hundred ms is fine):

```ts
describe('PasswordHasher', () => {
  let hasher: PasswordHasher;

  beforeEach(async () => {
    hasher = new PasswordHasher();
    await hasher.onModuleInit();
  });

  describe('hash', () => {
    it('returns an argon2id hash', async () => {
      expect(await hasher.hash('correct horse battery')).toMatch(/^\$argon2id\$/);
    });
  });

  describe('verify', () => {
    describe('when the password matches', () => {
      it('returns true', async () => {
        const hash = await hasher.hash('correct horse battery');

        expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
      });
    });

    describe('when the password differs', () => {
      it('returns false', async () => {
        const hash = await hasher.hash('correct horse battery');

        expect(await hasher.verify(hash, 'wrong password')).toBe(false);
      });
    });
  });

  describe('verifyDummy', () => {
    it('resolves without a value', async () => {
      await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/auth/password-hasher.spec.ts`; expect FAIL.
- [ ] **Step 3: Implement.** Only file importing `argon2`. `hash` wraps `argon2.hash(plain, { type: argon2.argon2id })` and returns through `passwordHash()`. `verify` wraps `argon2.verify`. `onModuleInit` stores `await this.hash('dummy-password')` in a private readonly-after-init field.
- [ ] **Step 4: Run;** expect PASS. Run `npm run lint:arch`.
- [ ] **Step 5: Commit** `feat(auth): add argon2id password hasher adapter`.

---

### Task 4: TokenService (JWT and refresh token generation)

**Files:**
- Create: `src/auth/token.service.ts`
- Test: `src/auth/token.service.spec.ts`

**Interfaces:**
- Consumes: `AuthConfig`, `JwtService` from `@nestjs/jwt`, `refreshTokenHash`, `AthleteId`.
- Produces: `@Injectable() class TokenService` (constructor: `JwtService`, `config: AuthConfig`, both `private readonly`)
  - `signAccessToken(athleteId: AthleteId): Promise<string>` (HS256, `sub`, `expiresIn` from config)
  - `verifyAccessToken(token: string): Promise<AthleteId>` (verifies with `algorithms: ['HS256']`; any failure logs `warn` and throws `UnauthorizedException('invalid_token')`)
  - `createRefreshToken(): { token: string; hash: RefreshTokenHash; expiresAt: Date }` (32 random bytes base64url; hash = SHA-256 hex; `expiresAt = now + refreshTtlSeconds`)
  - `hashRefreshToken(token: string): RefreshTokenHash`
  - `get accessTtlSeconds(): number`

- [ ] **Step 1: Failing spec.** Build the service with a real `JwtService` (`new JwtService({ secret })`) and a literal config. Cases:
  - `signAccessToken` then `verifyAccessToken` round-trips to the same id.
  - `when the token is signed with another secret` -> rejects `UnauthorizedException` with message `invalid_token`.
  - `when the token is expired` (config TTL 1 s with fake timers, or sign with `expiresIn: -1` via a second service instance) -> rejects `invalid_token`.
  - `when the token is malformed` -> rejects `invalid_token`.
  - `when the token uses alg none` (hand-built unsigned token) -> rejects `invalid_token`.
  - `createRefreshToken`: two calls produce different tokens; `hash` equals `hashRefreshToken(token)`; `expiresAt` is about `refreshTtlSeconds` ahead (use fake timers).
  - `hashRefreshToken` is deterministic and returns 64 hex chars.
- [ ] **Step 2: Run** `npx vitest run src/auth/token.service.spec.ts`; expect FAIL.
- [ ] **Step 3: Implement** per interface (`node:crypto` `randomBytes`, `createHash`).
- [ ] **Step 4: Run;** expect PASS.
- [ ] **Step 5: Commit** `feat(auth): add token service for access jwt and refresh token generation`.

---

### Task 5: Athlete db/service additions and the 18+ invariant

**Files:**
- Modify: `src/athletes/athlete.db.ts`, `src/athletes/athlete.service.ts`
- Create: `src/athletes/public-athlete.ts`
- Test: `src/athletes/athlete.service.spec.ts` (extend), `src/athletes/public-athlete.spec.ts`

**Interfaces:**
- Consumes: `NormalizedEmail` (`../common/email.js`), `PasswordHash`, Prisma `Athlete`.
- Produces:
  - `AthleteDb.findByEmail(email: NormalizedEmail): Promise<Athlete | null>`
  - `AthleteDb.create(data: { name: string; email: NormalizedEmail; passwordHash: PasswordHash; adultAttestedAt: Date }): Promise<Athlete | null>`: sets `isAdult: true`; catches `Prisma.PrismaClientKnownRequestError` with code `P2002` and returns `null`; rethrows anything else. No domain throws.
  - `AthleteService.findByEmail(email: NormalizedEmail): Promise<AthleteRecord | null>`
  - `AthleteService.register(input: { name: string; email: NormalizedEmail; passwordHash: PasswordHash; adultAttested: boolean | undefined }): Promise<AthleteRecord>`:
    - `adultAttested !== true`: warn-log, throw `BadRequestException('adult_attestation_required')`, no db call.
    - db returns `null`: warn-log with the email, throw `BadRequestException('email_already_registered')`.
    - otherwise calls `db.create` with `adultAttestedAt: new Date()` and returns the row.
  - `type PublicAthlete = { id: AthleteId; name: string; email: string; isAdult: boolean }`; `toPublicAthlete(athlete: AthleteRecord): PublicAthlete` (strips everything else, notably `passwordHash`).

- [ ] **Step 1: Failing specs** added to the existing spec's `describe('AthleteService')`:

```ts
describe('register', () => {
  const input = { name: 'Jamie Lee', email: 'jamie@example.com' as NormalizedEmail, passwordHash: '$argon2id$x' as PasswordHash };

  describe('when adultAttested is not true', () => {
    it.each([false, undefined])('rejects %s with adult_attestation_required', async (adultAttested) => {
      await expect(service.register({ ...input, adultAttested })).rejects.toThrow('adult_attestation_required');
    });

    it('does not touch the database', async () => {
      await service.register({ ...input, adultAttested: false }).catch(() => undefined);

      expect(db.create).not.toHaveBeenCalled();
    });
  });

  describe('when attested and the email is free', () => {
    it('creates the athlete with a server-side attestation timestamp', async () => { /* fake timers; expect db.create called with adultAttestedAt = frozen now */ });
  });

  describe('when the email is already registered', () => {
    it('throws BadRequestException email_already_registered', async () => { /* db.create resolves null */ });
  });
});

describe('findByEmail', () => { /* delegates to db and returns row or null */ });
```

  Also a `public-athlete.spec.ts` asserting the output has exactly keys `id,name,email,isAdult` for an input carrying `passwordHash`, `trustScore`, etc.
- [ ] **Step 2: Run** `npx vitest run src/athletes`; expect FAIL.
- [ ] **Step 3: Implement** per interfaces. Keep `athlete.service.ts` free of Prisma imports.
- [ ] **Step 4: Run;** expect PASS, plus `npm run lint:arch`.
- [ ] **Step 5: Commit** `feat(athletes): add registration with 18+ attestation and email lookup`.

---

### Task 6: RefreshTokenDb

**Files:**
- Create: `src/auth/refresh-token.db.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AthleteId`, `RefreshTokenHash`.
- Produces: `@Injectable() class RefreshTokenDb`
  - `create(data: { athleteId: AthleteId; tokenHash: RefreshTokenHash; expiresAt: Date }): Promise<RefreshToken>`
  - `findByHash(tokenHash: RefreshTokenHash): Promise<RefreshToken | null>`
  - `revokeIfActive(id: string): Promise<boolean>`: `updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })`, returns `count === 1`. Atomic so concurrent refreshes cannot both win.
  - `revokeAllForAthlete(athleteId: AthleteId): Promise<void>`: sets `revokedAt` on all rows where `revokedAt` is null.
  - `revokeByHash(tokenHash: RefreshTokenHash): Promise<void>`: for logout; no-op if absent.

Like the other `*.db.ts` files in the repo, this thin passthrough has no unit spec (covered via mocks in Task 7 and the manual flow in Task 9).

- [ ] **Step 1: Implement** per interface; no domain throws.
- [ ] **Step 2: Verify** `npm run build && npm run lint:arch`.
- [ ] **Step 3: Commit** `feat(auth): add refresh token db access`.

---

### Task 7: AuthService

**Files:**
- Create: `src/auth/auth.service.ts`
- Test: `src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `AthleteService` (Task 5), `RefreshTokenDb` (Task 6), `TokenService` (Task 4), `PasswordHasher` (Task 3), `normalizeEmail`.
- Produces: `@Injectable() class AuthService` (all deps `private readonly`, own `Logger`)
  - `type AuthTokens = { accessToken: string; refreshToken: string; expiresIn: number }`
  - `type AuthResult = AuthTokens & { athlete: PublicAthlete }`
  - `signup(input: { name: string; email: string; password: string; adultAttested: boolean | undefined }): Promise<AuthResult>`: `normalizeEmail`, `hasher.hash`, `athleteService.register` (attestation and conflict errors propagate), then issue tokens.
  - `login(input: { email: string; password: string }): Promise<AuthResult>`:
    - athlete not found: `hasher.verifyDummy(password)`, warn-log, throw `UnauthorizedException('invalid_credentials')`.
    - password mismatch: warn-log with athlete id, same exception.
    - match but `isBanned`: warn-log, `ForbiddenException('athlete_banned')`, no tokens.
    - else issue tokens.
  - `refresh(refreshToken: string): Promise<AuthTokens>`:
    - hash it; `findByHash` null: warn-log, `UnauthorizedException('invalid_refresh_token')`.
    - row `revokedAt != null`: warn-log "reuse detected", `revokeAllForAthlete`, throw `invalid_refresh_token`.
    - row expired (`expiresAt <= now`): warn-log, throw `invalid_refresh_token`.
    - `revokeIfActive` returns false (lost race): same as reuse (revoke all, throw).
    - athlete lookup via `athleteService.getById`; banned: `ForbiddenException('athlete_banned')`.
    - else persist a new refresh token (`createRefreshToken` then `db.create`) and return a new pair.
  - `logout(refreshToken: string): Promise<void>`: `revokeByHash(hashRefreshToken(refreshToken))`.
  - Private `issueTokens(athleteId: AthleteId): Promise<AuthTokens>`: `signAccessToken`, `createRefreshToken`, `db.create`.

- [ ] **Step 1: Failing spec.** Mock all four collaborators with `mockDeep`. One `describe` per condition listed above, each with a short outcome-only `it`. Required cases (each asserts exception class, snake_case message, and where relevant the warn log):
  - signup: `when attestation is missing` propagates `adult_attestation_required` and issues no tokens; `when the email is taken` propagates `email_already_registered`; `when valid` hashes the password, passes the normalized email, returns athlete (public shape) and tokens, and the plaintext password never reaches `athleteService.register`.
  - login: unknown email calls `verifyDummy` and throws `invalid_credentials`; wrong password throws `invalid_credentials` (same message as unknown email); banned throws `athlete_banned` and `tokenService.signAccessToken` not called; success returns tokens.
  - refresh: unknown token; revoked token revokes all and throws; expired token; lost revoke race revokes all; banned athlete; success revokes the old row before creating the new one (assert call order with `mock.invocationCallOrder`) and returns a new pair.
  - logout: calls `revokeByHash` with the hash, resolves even if token unknown.
  - No log call contains the plaintext password or token (assert on the spied `Logger.prototype.warn` arguments).
- [ ] **Step 2: Run** `npx vitest run src/auth/auth.service.spec.ts`; expect FAIL.
- [ ] **Step 3: Implement** per interface. Order inside `refresh`: validate, revoke-if-active, check ban, create new pair (fail closed).
- [ ] **Step 4: Run;** expect PASS. `npm run lint:arch`.
- [ ] **Step 5: Commit** `feat(auth): add signup, login, refresh and logout service`.

---

### Task 8: Guard, DTOs, controller, module wiring

**Files:**
- Create: `src/auth/jwt-auth.guard.ts`, `src/auth/current-athlete-id.decorator.ts`, `src/auth/dto/signup.dto.ts`, `src/auth/dto/login.dto.ts`, `src/auth/dto/refresh.dto.ts`, `src/auth/auth.controller.ts`, `src/auth/auth.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/auth/jwt-auth.guard.spec.ts`

**Interfaces:**
- Consumes: `AuthService`, `TokenService`, `AthleteService.getById`, `toPublicAthlete`, `AuthConfig`.
- Produces:
  - `JwtAuthGuard implements CanActivate`: reads `Authorization: Bearer <token>`; missing/non-Bearer: warn-log, `UnauthorizedException('invalid_token')`; else `tokenService.verifyAccessToken`, sets `request.athleteId`, returns true.
  - `@CurrentAthleteId()` param decorator returning `request.athleteId` as `AthleteId`.
  - DTO classes (class-validator): `SignupDto { name: string (@IsString @Transform trim @Length(1,100)); email: string (@IsEmail); password: string (@IsString @Length(10,128)); adultAttested?: boolean (@IsOptional @IsBoolean) }`, `LoginDto { email (@IsEmail); password (@IsString @Length(1,128)) }`, `RefreshDto { refreshToken (@IsString @Length(1,512)) }`. Used by `logout` too.
  - `AuthController` (`@Controller('auth')`): `POST signup` (201), `POST login` (`@HttpCode(200)`), `POST refresh` (`@HttpCode(200)`), `POST logout` (`@HttpCode(204)`), `GET me` (`@UseGuards(JwtAuthGuard)`, returns `toPublicAthlete(await athleteService.getById(athleteId))`). `@Throttle({ default: { limit: 10, ttl: 60000 } })` on signup, login, refresh.
  - `AuthModule`: imports `AthletesModule` and `JwtModule.registerAsync` (secret from `ConfigService`); `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` in `AppModule`; providers `AuthService`, `TokenService`, `PasswordHasher`, `RefreshTokenDb`, `JwtAuthGuard`; exports `JwtAuthGuard`, `TokenService` so later modules can guard routes. Register in `AppModule`.

- [ ] **Step 1: Failing guard spec** (nested): `when the header is missing` throws `invalid_token`; `when the scheme is not Bearer` throws `invalid_token`; `when the token is invalid` propagates `invalid_token` from `TokenService`; `when the token is valid` returns true and sets `request.athleteId`. Build the `ExecutionContext` with `mockDeep<ExecutionContext>()` and `switchToHttp().getRequest()` returning a plain object.
- [ ] **Step 2: Run** `npx vitest run src/auth/jwt-auth.guard.spec.ts`; expect FAIL.
- [ ] **Step 3: Implement** all files per interfaces. Controller has no logic beyond delegation and `toPublicAthlete`. Make sure the controller never returns the raw athlete record.
- [ ] **Step 4: Verify** `npm run build && npm test && npm run lint && npm run lint:arch`; all green.
- [ ] **Step 5: Commit** `feat(auth): add auth controller, jwt guard and module wiring`.

---

### Task 9: Platform hardening, docs and end-to-end verification

**Files:**
- Create: `src/common/validation-pipe.ts`
- Test: `src/common/validation-pipe.spec.ts`
- Modify: `src/main.ts`, `src/app.module.ts`, `README.md`

**Interfaces:**
- Produces: `createValidationPipe(): ValidationPipe`, configured with `whitelist: true`, `forbidNonWhitelisted: true`, and an `exceptionFactory` that logs the per-field constraint messages at `warn` (class `ValidationPipe` logger name `Validation`) and returns `new BadRequestException('validation_failed')`.

- [ ] **Step 1: Failing spec** for the pipe: `when the body has an unknown field` rejects with message `validation_failed`; `when a field fails a constraint` rejects with `validation_failed` and the warn log mentions the field name; `when valid` returns the transformed DTO. Use `pipe.transform(value, { type: 'body', metatype: SignupDto })`.
- [ ] **Step 2: Run** `npx vitest run src/common/validation-pipe.spec.ts`; expect FAIL.
- [ ] **Step 3: Implement the pipe.** In `main.ts`: `app.useGlobalPipes(createValidationPipe())` and `app.enableCors({ origin: <CORS_ORIGINS split on commas, trimmed, empty entries dropped> })` (empty list means no cross-origin allowed). In `AppModule`: `ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])` and `{ provide: APP_GUARD, useClass: ThrottlerGuard }`.
- [ ] **Step 4: README** gets a short "Auth" section: endpoints table, required env vars (`JWT_SECRET` min 32 chars, TTLs, `CORS_ORIGINS`), and the known tradeoffs from spec section 9 (no email verification, 400 email_already_registered enumeration, `trust proxy` not yet set).
- [ ] **Step 5: Automated checks:** `npm run build && npm test && npm run lint && npm run lint:arch`; all green.
- [ ] **Step 6: Manual flow** (for qa-verifier; DB up on 5435, `JWT_SECRET` set, `npm run build && npm start`). Expected results:
  - `POST /auth/signup` without `adultAttested` -> 400 `adult_attestation_required`; with `false` -> same; row count in `athletes` unchanged.
  - `POST /auth/signup` valid -> 201 with athlete (`isAdult: true`), tokens; DB row has `adult_attested_at` set and `password_hash` starting `$argon2id$`.
  - Same email again (different case) -> 400 `email_already_registered`.
  - `POST /auth/login` wrong password and unknown email -> both 401 `invalid_credentials`; after setting `is_banned = true` with the right password -> 403 `athlete_banned`.
  - `GET /auth/me` with access token -> 200 public shape (no `passwordHash`); without or with garbage token -> 401 `invalid_token`.
  - `POST /auth/refresh` -> 200 new pair; reusing the old refresh token -> 401 `invalid_refresh_token` and the new refresh token is now also rejected (all revoked).
  - `POST /auth/logout` then `refresh` with that token -> 401.
  - Unknown body field on signup -> 400 `validation_failed`.
  - 11 rapid `POST /auth/login` calls from one IP -> the last returns 429.
  - Boot without `JWT_SECRET` (or a short one) -> process exits with a logged `env_invalid`.
- [ ] **Step 7: Stage and stop.** Stage all changes; do not commit the final changes. Tell the user the work is staged so they can run `/crit` before the commit (`feat(auth): add athlete signup/login with 18+ attestation and platform hardening` is the intended message). Rename the branch to `hyr-03` before any push/PR.
