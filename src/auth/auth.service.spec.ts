import { BadRequestException, ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AthleteService } from '../athletes/athlete.service';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenDb } from './refresh-token.db';
import { TokenService } from './token.service';
import type { PasswordHash } from '../common/password-hash';
import type { RefreshTokenHash } from '../common/refresh-token-hash';

const PASSWORD = 'plaintext-password-123';
const REFRESH_TOKEN = 'plaintext-refresh-token';
const hash = 'a'.repeat(64) as RefreshTokenHash;
const newHash = 'b'.repeat(64) as RefreshTokenHash;
const storedHash = '$argon2id$stored' as PasswordHash;

const athlete = {
  id: 'athlete-1',
  name: 'Jamie Lee',
  email: 'jamie@example.com',
  isAdult: true,
  isBanned: false,
  passwordHash: storedHash,
  trustScore: 50,
};

describe('AuthService', () => {
  let athleteService: DeepMockProxy<AthleteService>;
  let refreshTokenDb: DeepMockProxy<RefreshTokenDb>;
  let tokenService: DeepMockProxy<TokenService>;
  let hasher: DeepMockProxy<PasswordHasher>;
  let service: AuthService;
  let warn: MockInstance;

  beforeEach(async () => {
    athleteService = mockDeep<AthleteService>();
    refreshTokenDb = mockDeep<RefreshTokenDb>();
    tokenService = mockDeep<TokenService>();
    hasher = mockDeep<PasswordHasher>();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    (tokenService as { accessTtlSeconds: number }).accessTtlSeconds = 900;
    tokenService.signAccessToken.mockResolvedValue('access-jwt');
    tokenService.createRefreshToken.mockReturnValue({
      token: 'new-refresh-token',
      hash: newHash,
      expiresAt: new Date('2026-11-01T00:00:00Z'),
    });
    tokenService.hashRefreshToken.mockReturnValue(hash);
    hasher.hash.mockResolvedValue(storedHash);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AthleteService, useValue: athleteService },
        { provide: RefreshTokenDb, useValue: refreshTokenDb },
        { provide: TokenService, useValue: tokenService },
        { provide: PasswordHasher, useValue: hasher },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function loggedText(): string {
    return JSON.stringify(warn.mock.calls);
  }

  describe('signup', () => {
    const input = { name: 'Jamie Lee', email: '  Jamie@Example.com ', password: PASSWORD, adultAttested: true };

    describe('when attestation is missing', () => {
      beforeEach(() => {
        athleteService.assertAdultAttested.mockImplementation(() => {
          throw new BadRequestException('adult_attestation_required');
        });
      });

      it('propagates adult_attestation_required', async () => {
        await expect(service.signup({ ...input, adultAttested: undefined })).rejects.toThrow(
          'adult_attestation_required',
        );
      });

      it('does not hash the password', async () => {
        await service.signup({ ...input, adultAttested: undefined }).catch(() => undefined);

        expect(hasher.hash).not.toHaveBeenCalled();
      });

      it('issues no tokens', async () => {
        await service.signup({ ...input, adultAttested: undefined }).catch(() => undefined);

        expect(tokenService.signAccessToken).not.toHaveBeenCalled();
      });
    });

    describe('when the email is taken', () => {
      it('propagates email_already_registered', async () => {
        athleteService.register.mockRejectedValue(new BadRequestException('email_already_registered'));

        await expect(service.signup(input)).rejects.toThrow('email_already_registered');
      });
    });

    describe('when the input is valid', () => {
      beforeEach(() => {
        athleteService.register.mockResolvedValue(athlete as never);
      });

      it('registers with the normalized email and hashed password', async () => {
        await service.signup(input);

        expect(athleteService.register).toHaveBeenCalledWith({
          name: 'Jamie Lee',
          email: 'jamie@example.com',
          passwordHash: storedHash,
          adultAttested: true,
        });
      });

      it('never passes the plaintext password to the athlete service', async () => {
        await service.signup(input);

        expect(JSON.stringify(athleteService.register.mock.calls)).not.toContain(PASSWORD);
      });

      it('returns the public athlete and a token pair', async () => {
        expect(await service.signup(input)).toEqual({
          athlete: { id: 'athlete-1', name: 'Jamie Lee', email: 'jamie@example.com', isAdult: true },
          accessToken: 'access-jwt',
          refreshToken: 'new-refresh-token',
          expiresIn: 900,
        });
      });

      it('persists the hashed refresh token', async () => {
        await service.signup(input);

        expect(refreshTokenDb.create).toHaveBeenCalledWith({
          athleteId: 'athlete-1',
          tokenHash: newHash,
          expiresAt: new Date('2026-11-01T00:00:00Z'),
        });
      });
    });
  });

  describe('login', () => {
    const input = { email: 'Jamie@example.com', password: PASSWORD };

    describe('when the athlete is unknown', () => {
      beforeEach(() => {
        athleteService.findByEmail.mockResolvedValue(null);
      });

      it('throws invalid_credentials', async () => {
        await expect(service.login(input)).rejects.toThrow(UnauthorizedException);
        await expect(service.login(input)).rejects.toThrow('invalid_credentials');
      });

      it('verifies against the dummy hash', async () => {
        await service.login(input).catch(() => undefined);

        expect(hasher.verifyDummy).toHaveBeenCalledWith(PASSWORD);
      });

      it('does not log the email', async () => {
        await service.login(input).catch(() => undefined);

        expect(loggedText()).not.toContain('jamie@example.com');
      });
    });

    describe('when the password is wrong', () => {
      beforeEach(() => {
        athleteService.findByEmail.mockResolvedValue(athlete as never);
        hasher.verify.mockResolvedValue(false);
      });

      it('throws invalid_credentials', async () => {
        await expect(service.login(input)).rejects.toThrow('invalid_credentials');
      });

      it('logs the athlete id without the password', async () => {
        await service.login(input).catch(() => undefined);

        expect(loggedText()).toContain('athlete-1');
        expect(loggedText()).not.toContain(PASSWORD);
      });
    });

    describe('when the athlete is banned', () => {
      beforeEach(() => {
        athleteService.findByEmail.mockResolvedValue({ ...athlete, isBanned: true } as never);
        hasher.verify.mockResolvedValue(true);
      });

      it('throws athlete_banned', async () => {
        await expect(service.login(input)).rejects.toThrow(ForbiddenException);
        await expect(service.login(input)).rejects.toThrow('athlete_banned');
      });

      it('issues no tokens', async () => {
        await service.login(input).catch(() => undefined);

        expect(tokenService.signAccessToken).not.toHaveBeenCalled();
      });
    });

    describe('when the credentials are valid', () => {
      beforeEach(() => {
        athleteService.findByEmail.mockResolvedValue(athlete as never);
        hasher.verify.mockResolvedValue(true);
      });

      it('looks the athlete up by normalized email', async () => {
        await service.login(input);

        expect(athleteService.findByEmail).toHaveBeenCalledWith('jamie@example.com');
      });

      it('returns the public athlete and a token pair', async () => {
        expect(await service.login(input)).toEqual({
          athlete: { id: 'athlete-1', name: 'Jamie Lee', email: 'jamie@example.com', isAdult: true },
          accessToken: 'access-jwt',
          refreshToken: 'new-refresh-token',
          expiresIn: 900,
        });
      });
    });
  });

  describe('refresh', () => {
    const activeRow = {
      id: 'token-1',
      athleteId: 'athlete-1',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    };

    describe('when the token is unknown', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(null);
      });

      it('throws invalid_refresh_token', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow(UnauthorizedException);
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');
      });

      it('does not log the token', async () => {
        await service.refresh(REFRESH_TOKEN).catch(() => undefined);

        expect(loggedText()).not.toContain(REFRESH_TOKEN);
      });
    });

    describe('when the token was already revoked', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue({ ...activeRow, revokedAt: new Date() } as never);
      });

      it('throws invalid_refresh_token', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');
      });

      it('revokes all tokens of the athlete', async () => {
        await service.refresh(REFRESH_TOKEN).catch(() => undefined);

        expect(refreshTokenDb.revokeAllForAthlete).toHaveBeenCalledWith('athlete-1');
      });
    });

    describe('when the token is expired', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue({ ...activeRow, expiresAt: new Date(Date.now() - 1) } as never);
      });

      it('throws invalid_refresh_token', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');
      });

      it('does not rotate', async () => {
        await service.refresh(REFRESH_TOKEN).catch(() => undefined);

        expect(refreshTokenDb.revokeIfActive).not.toHaveBeenCalled();
      });
    });

    describe('when the revoke race is lost', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(activeRow as never);
        refreshTokenDb.revokeIfActive.mockResolvedValue(false);
      });

      it('throws invalid_refresh_token', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');
      });

      it('revokes all tokens of the athlete', async () => {
        await service.refresh(REFRESH_TOKEN).catch(() => undefined);

        expect(refreshTokenDb.revokeAllForAthlete).toHaveBeenCalledWith('athlete-1');
      });
    });

    describe('when the athlete is banned', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(activeRow as never);
        refreshTokenDb.revokeIfActive.mockResolvedValue(true);
        athleteService.getById.mockResolvedValue({ ...athlete, isBanned: true } as never);
      });

      it('throws athlete_banned', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow(ForbiddenException);
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('athlete_banned');
      });

      it('issues no new tokens', async () => {
        await service.refresh(REFRESH_TOKEN).catch(() => undefined);

        expect(refreshTokenDb.create).not.toHaveBeenCalled();
      });
    });

    describe('when the token is valid', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(activeRow as never);
        refreshTokenDb.revokeIfActive.mockResolvedValue(true);
        athleteService.getById.mockResolvedValue(athlete as never);
      });

      it('returns a new token pair', async () => {
        expect(await service.refresh(REFRESH_TOKEN)).toEqual({
          accessToken: 'access-jwt',
          refreshToken: 'new-refresh-token',
          expiresIn: 900,
        });
      });

      it('revokes the old row before creating the new one', async () => {
        await service.refresh(REFRESH_TOKEN);

        const revokeOrder = refreshTokenDb.revokeIfActive.mock.invocationCallOrder[0];
        const createOrder = refreshTokenDb.create.mock.invocationCallOrder[0];

        expect(revokeOrder).toBeLessThan(createOrder);
      });
    });
  });

  describe('logout', () => {
    describe('when called with a token', () => {
      it('revokes by the token hash', async () => {
        await service.logout(REFRESH_TOKEN);

        expect(refreshTokenDb.revokeByHash).toHaveBeenCalledWith(hash);
      });
    });

    describe('when the token is unknown', () => {
      it('still resolves', async () => {
        refreshTokenDb.revokeByHash.mockResolvedValue(undefined);

        await expect(service.logout(REFRESH_TOKEN)).resolves.toBeUndefined();
      });
    });
  });
});
