import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type MockInstance } from 'vitest';
import { TokenService } from './token.service';
import type { AuthConfig } from './auth.config';
import type { AthleteId } from '../common/ids';

const config: AuthConfig = {
  jwtSecret: 's'.repeat(32),
  accessTtlSeconds: 900,
  refreshTtlSeconds: 3600,
};
const athleteId = 'athlete-1' as AthleteId;

function buildService(overrides: Partial<AuthConfig> = {}): TokenService {
  const merged = { ...config, ...overrides };

  return new TokenService(new JwtService({ secret: merged.jwtSecret }), merged);
}

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('TokenService', () => {
  let service: TokenService;
  let warn: MockInstance;

  beforeEach(() => {
    service = buildService();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  describe('signAccessToken and verifyAccessToken', () => {
    it('round-trips the athlete id', async () => {
      const token = await service.signAccessToken(athleteId);

      expect(await service.verifyAccessToken(token)).toBe(athleteId);
    });
  });

  describe('verifyAccessToken', () => {
    describe('when the token is signed with another secret', () => {
      it('rejects with invalid_token', async () => {
        const token = await buildService({ jwtSecret: 'o'.repeat(32) }).signAccessToken(athleteId);

        await expect(service.verifyAccessToken(token)).rejects.toThrow(UnauthorizedException);
        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the token is expired', () => {
      it('rejects with invalid_token', async () => {
        vi.useFakeTimers();
        const token = await service.signAccessToken(athleteId);
        vi.advanceTimersByTime((config.accessTtlSeconds + 1) * 1000);

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the token is malformed', () => {
      it('rejects with invalid_token', async () => {
        await expect(service.verifyAccessToken('not-a-jwt')).rejects.toThrow('invalid_token');
      });
    });

    describe('when the token uses alg none', () => {
      it('rejects with invalid_token', async () => {
        const token = `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({ sub: athleteId })}.`;

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the token is invalid', () => {
      it('logs a warning', async () => {
        await service.verifyAccessToken('not-a-jwt').catch(() => undefined);

        expect(warn).toHaveBeenCalled();
      });
    });
  });

  describe('createRefreshToken', () => {
    it('produces a different token each call', () => {
      expect(service.createRefreshToken().token).not.toBe(service.createRefreshToken().token);
    });

    it('returns the hash of the token', () => {
      const created = service.createRefreshToken();

      expect(created.hash).toBe(service.hashRefreshToken(created.token));
    });

    it('expires after the refresh ttl', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));

      expect(service.createRefreshToken().expiresAt).toEqual(new Date('2026-10-01T01:00:00Z'));
    });
  });

  describe('hashRefreshToken', () => {
    it('is deterministic', () => {
      expect(service.hashRefreshToken('abc')).toBe(service.hashRefreshToken('abc'));
    });

    it('returns 64 hex chars', () => {
      expect(service.hashRefreshToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('accessTtlSeconds', () => {
    it('returns the configured ttl', () => {
      expect(service.accessTtlSeconds).toBe(900);
    });
  });
});
