import { Logger, UnauthorizedException } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PasswordHasher } from '../auth/password-hasher';
import type { PasswordHash } from '../common/password-hash';
import type { RefreshTokenHash } from '../common/refresh-token-hash';
import { StaffAuthService } from './staff-auth.service';
import { StaffRefreshTokenDb, type StaffRefreshTokenRecord } from './staff-refresh-token.db';
import type { StaffRefreshTokenId } from '../common/ids';
import { StaffTokenService } from './staff-token.service';
import type { StaffRow } from './staff.db';
import { StaffService } from './staff.service';

const PASSWORD = 'plaintext-password-123';
const REFRESH_TOKEN = 'plaintext-refresh-token';
const oldHash = 'a'.repeat(64) as RefreshTokenHash;
const newHash = 'b'.repeat(64) as RefreshTokenHash;
const storedHash = '$argon2id$stored' as PasswordHash;

const staff = {
  id: 'staff-1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  passwordHash: storedHash,
  isActive: true,
} as StaffRow;

function refreshRow(overrides: Partial<StaffRefreshTokenRecord> = {}): StaffRefreshTokenRecord {
  return {
    id: 'token-1' as StaffRefreshTokenId,
    staffId: staff.id,
    tokenHash: oldHash,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as StaffRefreshTokenRecord;
}

describe('StaffAuthService', () => {
  let staffService: DeepMockProxy<StaffService>;
  let refreshTokenDb: DeepMockProxy<StaffRefreshTokenDb>;
  let tokenService: DeepMockProxy<StaffTokenService>;
  let hasher: DeepMockProxy<PasswordHasher>;
  let service: StaffAuthService;
  let warn: MockInstance;

  beforeEach(() => {
    staffService = mockDeep<StaffService>();
    refreshTokenDb = mockDeep<StaffRefreshTokenDb>();
    tokenService = mockDeep<StaffTokenService>();
    hasher = mockDeep<PasswordHasher>();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    (tokenService as { accessTtlSeconds: number }).accessTtlSeconds = 900;
    tokenService.signAccessToken.mockResolvedValue('access-jwt');
    tokenService.createRefreshToken.mockReturnValue({
      token: 'new-refresh-token',
      hash: newHash,
      expiresAt: new Date('2026-10-16T00:00:00Z'),
    });
    tokenService.hashRefreshToken.mockReturnValue(oldHash);
    service = new StaffAuthService(staffService, refreshTokenDb, tokenService, hasher);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function loggedText(): string {
    return JSON.stringify(warn.mock.calls);
  }

  describe('login', () => {
    const input = { email: '  Jane@Example.com ', password: PASSWORD };

    describe('when credentials are valid', () => {
      beforeEach(() => {
        staffService.findByEmail.mockResolvedValue(staff);
        hasher.verify.mockResolvedValue(true);
      });

      it('returns tokens and the public staff', async () => {
        const result = await service.login(input);

        expect(result).toEqual({
          accessToken: 'access-jwt',
          refreshToken: 'new-refresh-token',
          expiresIn: 900,
          staff: { id: 'staff-1', name: 'Jane Doe', email: 'jane@example.com' },
        });
      });

      it('persists the refresh token hash and expiry', async () => {
        await service.login(input);

        expect(refreshTokenDb.create).toHaveBeenCalledWith({
          staffId: staff.id,
          tokenHash: newHash,
          expiresAt: new Date('2026-10-16T00:00:00Z'),
        });
      });

      it('does not leak the password hash', async () => {
        expect(JSON.stringify(await service.login(input))).not.toContain('argon2id');
      });
    });

    describe('when the email is mixed case or padded', () => {
      it('looks up the normalised email', async () => {
        staffService.findByEmail.mockResolvedValue(staff);
        hasher.verify.mockResolvedValue(true);

        await service.login(input);

        expect(staffService.findByEmail).toHaveBeenCalledWith('jane@example.com');
      });
    });

    describe('when the email is unknown', () => {
      beforeEach(() => {
        staffService.findByEmail.mockResolvedValue(null);
      });

      it('verifies a dummy hash and throws invalid_credentials', async () => {
        await expect(service.login(input)).rejects.toThrow(UnauthorizedException);
        await expect(service.login(input)).rejects.toThrow('invalid_credentials');

        expect(hasher.verifyDummy).toHaveBeenCalledWith(PASSWORD);
      });

      it('logs a warning without the password', async () => {
        await service.login(input).catch(() => undefined);

        expect(warn).toHaveBeenCalled();
        expect(loggedText()).not.toContain(PASSWORD);
      });
    });

    describe('when the password is wrong', () => {
      beforeEach(() => {
        staffService.findByEmail.mockResolvedValue(staff);
        hasher.verify.mockResolvedValue(false);
      });

      it('throws invalid_credentials', async () => {
        await expect(service.login(input)).rejects.toThrow('invalid_credentials');
      });

      it('signs nothing', async () => {
        await service.login(input).catch(() => undefined);

        expect(tokenService.signAccessToken).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the account is inactive', () => {
      beforeEach(() => {
        staffService.findByEmail.mockResolvedValue({ ...staff, isActive: false });
        hasher.verify.mockResolvedValue(true);
      });

      it('throws invalid_credentials after verifying the password', async () => {
        await expect(service.login(input)).rejects.toThrow('invalid_credentials');

        expect(hasher.verify).toHaveBeenCalledWith(storedHash, PASSWORD);
      });

      it('signs nothing', async () => {
        await service.login(input).catch(() => undefined);

        expect(tokenService.signAccessToken).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
      });
    });
  });

  describe('refresh', () => {
    describe('when the token is valid', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(refreshRow());
        refreshTokenDb.revokeIfActive.mockResolvedValue(true);
        staffService.findActiveById.mockResolvedValue(staff);
      });

      it('revokes the old token before persisting the new one', async () => {
        await service.refresh(REFRESH_TOKEN);

        const revokeOrder = refreshTokenDb.revokeIfActive.mock.invocationCallOrder[0] ?? 0;
        const createOrder = refreshTokenDb.create.mock.invocationCallOrder[0] ?? 0;

        expect(refreshTokenDb.revokeIfActive).toHaveBeenCalledWith('token-1');
        expect(revokeOrder).toBeLessThan(createOrder);
      });

      it('returns a new pair', async () => {
        expect(await service.refresh(REFRESH_TOKEN)).toEqual({
          accessToken: 'access-jwt',
          refreshToken: 'new-refresh-token',
          expiresIn: 900,
        });
      });
    });

    describe('when the staff is deactivated while the new pair is issued', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(refreshRow());
        refreshTokenDb.revokeIfActive.mockResolvedValue(true);
        staffService.findActiveById.mockResolvedValueOnce(staff).mockResolvedValueOnce(null);
      });

      it('revokes every refresh token and throws invalid_refresh_token', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');

        expect(refreshTokenDb.revokeAllForStaff).toHaveBeenCalledWith(staff.id);
      });
    });

    describe('when the password is reset while the new pair is issued', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(refreshRow());
        refreshTokenDb.revokeIfActive.mockResolvedValue(true);
        staffService.findActiveById
          .mockResolvedValueOnce({ ...staff, tokensValidAfter: null } as StaffRow)
          .mockResolvedValueOnce({ ...staff, tokensValidAfter: new Date() } as StaffRow);
      });

      it('revokes every refresh token and throws invalid_refresh_token', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');

        expect(refreshTokenDb.revokeAllForStaff).toHaveBeenCalledWith(staff.id);
      });
    });

    describe('when the token is unknown', () => {
      it('throws invalid_refresh_token', async () => {
        refreshTokenDb.findByHash.mockResolvedValue(null);

        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');
        expect(refreshTokenDb.revokeAllForStaff).not.toHaveBeenCalled();
      });
    });

    describe('when the token is expired', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(refreshRow({ expiresAt: new Date(Date.now() - 1000) }));
      });

      it('throws invalid_refresh_token', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');
      });

      it('does not revoke all tokens', async () => {
        await service.refresh(REFRESH_TOKEN).catch(() => undefined);

        expect(refreshTokenDb.revokeAllForStaff).not.toHaveBeenCalled();
      });
    });

    describe('when the token was already revoked', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(refreshRow({ revokedAt: new Date() }));
      });

      it('revokes all tokens of the staff member and throws', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');

        expect(refreshTokenDb.revokeAllForStaff).toHaveBeenCalledWith(staff.id);
      });
    });

    describe('when revokeIfActive loses a race', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(refreshRow());
        refreshTokenDb.revokeIfActive.mockResolvedValue(false);
      });

      it('treats it as reuse', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');

        expect(refreshTokenDb.revokeAllForStaff).toHaveBeenCalledWith(staff.id);
        expect(tokenService.signAccessToken).not.toHaveBeenCalled();
      });
    });

    describe('when the staff is inactive or missing', () => {
      beforeEach(() => {
        refreshTokenDb.findByHash.mockResolvedValue(refreshRow());
        refreshTokenDb.revokeIfActive.mockResolvedValue(true);
        staffService.findActiveById.mockResolvedValue(null);
      });

      it('throws invalid_refresh_token and issues nothing', async () => {
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow(UnauthorizedException);
        await expect(service.refresh(REFRESH_TOKEN)).rejects.toThrow('invalid_refresh_token');

        expect(refreshTokenDb.create).not.toHaveBeenCalled();
      });
    });

    describe('when any rejection is logged', () => {
      it('never contains the token', async () => {
        refreshTokenDb.findByHash.mockResolvedValue(refreshRow({ revokedAt: new Date() }));

        await service.refresh(REFRESH_TOKEN).catch(() => undefined);

        expect(warn).toHaveBeenCalled();
        expect(loggedText()).not.toContain(REFRESH_TOKEN);
      });
    });
  });

  describe('logout', () => {
    it('revokes the token by hash', async () => {
      await service.logout(REFRESH_TOKEN);

      expect(refreshTokenDb.revokeByHash).toHaveBeenCalledWith(oldHash);
    });

    describe('when the token is unknown', () => {
      it('resolves without error', async () => {
        refreshTokenDb.revokeByHash.mockResolvedValue(undefined);

        await expect(service.logout('unknown')).resolves.toBeUndefined();
      });
    });
  });
});
