import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type MockInstance } from 'vitest';
import { StaffTokenService } from './staff-token.service';
import type { StaffAuthConfig } from './staff-auth.config';
import type { AuthConfig } from '../auth/auth.config';
import { TokenService } from '../auth/token.service';
import type { AthleteId, StaffId } from '../common/ids';

const SECRET = 's'.repeat(32);
const config: StaffAuthConfig = {
  accessTtlSeconds: 900,
  refreshTtlSeconds: 604_800,
};
const staffId = 'staff-1' as StaffId;

function buildService(secret: string = SECRET): StaffTokenService {
  return new StaffTokenService(new JwtService({ secret }), config);
}

function signRaw(payload: object, options: object = {}, secret: string = SECRET): Promise<string> {
  return new JwtService({ secret }).signAsync(payload, { algorithm: 'HS256', expiresIn: 900, ...options });
}

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('StaffTokenService', () => {
  let service: StaffTokenService;
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
    describe('when the token is valid', () => {
      it('round-trips the staff id with a numeric issuedAt', async () => {
        const token = await service.signAccessToken(staffId);
        const result = await service.verifyAccessToken(token);

        expect(result.staffId).toBe(staffId);
        expect(typeof result.issuedAt).toBe('number');
      });

      it('carries the audience and issuer', async () => {
        const token = await service.signAccessToken(staffId);
        const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<
          string,
          unknown
        >;

        expect(payload).toMatchObject({ aud: 'hyrox-staff', iss: 'hyrox-api', sub: staffId });
      });
    });

    describe('when the token is expired', () => {
      it('throws invalid_token', async () => {
        vi.useFakeTimers();
        const token = await service.signAccessToken(staffId);

        vi.advanceTimersByTime(901_000);

        await expect(service.verifyAccessToken(token)).rejects.toThrow(UnauthorizedException);
        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the token is signed with another secret', () => {
      it('throws invalid_token', async () => {
        const token = await buildService('o'.repeat(32)).signAccessToken(staffId);

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the token comes from the athlete TokenService', () => {
      it('throws invalid_token', async () => {
        const athleteConfig: AuthConfig = { jwtSecret: 'a'.repeat(32), accessTtlSeconds: 900, refreshTtlSeconds: 3600 };
        const athleteTokens = new TokenService(new JwtService({ secret: athleteConfig.jwtSecret }), athleteConfig);
        const token = await athleteTokens.signAccessToken('athlete-1' as AthleteId);

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the audience is wrong', () => {
      it('throws invalid_token', async () => {
        const token = await signRaw({ sub: staffId }, { audience: 'other', issuer: 'hyrox-api' });

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the issuer is wrong', () => {
      it('throws invalid_token', async () => {
        const token = await signRaw({ sub: staffId }, { audience: 'hyrox-staff', issuer: 'other' });

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the algorithm is none', () => {
      it('throws invalid_token', async () => {
        const token = `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({
          sub: staffId,
          aud: 'hyrox-staff',
          iss: 'hyrox-api',
        })}.`;

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the subject is missing', () => {
      it('throws invalid_token', async () => {
        const token = await signRaw({}, { audience: 'hyrox-staff', issuer: 'hyrox-api' });

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the subject is blank', () => {
      it('throws invalid_token', async () => {
        const token = await signRaw({ sub: '   ' }, { audience: 'hyrox-staff', issuer: 'hyrox-api' });

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the subject is not a string', () => {
      it('throws invalid_token', async () => {
        const token = await signRaw({ sub: 42 }, { audience: 'hyrox-staff', issuer: 'hyrox-api' });

        await expect(service.verifyAccessToken(token)).rejects.toThrow('invalid_token');
      });
    });
  });

  describe('when a staff token is verified by the athlete TokenService', () => {
    it('throws invalid_token', async () => {
      const athleteConfig: AuthConfig = { jwtSecret: 'a'.repeat(32), accessTtlSeconds: 900, refreshTtlSeconds: 3600 };
      const athleteTokens = new TokenService(new JwtService({ secret: athleteConfig.jwtSecret }), athleteConfig);
      const token = await service.signAccessToken(staffId);

      await expect(athleteTokens.verifyAccessToken(token)).rejects.toThrow('invalid_token');
    });
  });

  describe('accessTtlSeconds', () => {
    it('comes from the config', () => {
      expect(service.accessTtlSeconds).toBe(900);
    });
  });

  describe('createRefreshToken', () => {
    it('returns distinct base64url tokens', () => {
      const first = service.createRefreshToken();
      const second = service.createRefreshToken();

      expect(first.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(first.token).not.toBe(second.token);
    });

    it('returns a 64-hex hash matching hashRefreshToken', () => {
      const created = service.createRefreshToken();

      expect(created.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(created.hash).toBe(service.hashRefreshToken(created.token));
    });

    describe('when the clock is fixed', () => {
      it('expires after the refresh ttl', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));

        const created = service.createRefreshToken();

        expect(created.expiresAt.getTime()).toBe(Date.now() + 604_800_000);
      });
    });
  });
});
