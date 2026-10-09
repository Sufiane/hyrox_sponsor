import { UnauthorizedException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { StaffId } from '../common/ids';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService, type StaffAuthTokens, type StaffLoginResult } from './staff-auth.service';
import type { StaffRow } from './staff.db';
import { StaffService } from './staff.service';

describe('StaffAuthController', () => {
  const id = 'staff-1' as StaffId;
  const tokens: StaffAuthTokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
  let authService: DeepMockProxy<StaffAuthService>;
  let staffService: DeepMockProxy<StaffService>;
  let controller: StaffAuthController;

  beforeEach(() => {
    authService = mockDeep<StaffAuthService>();
    staffService = mockDeep<StaffService>();
    controller = new StaffAuthController(authService, staffService);
  });

  describe('login', () => {
    it('delegates and returns the result', async () => {
      const result: StaffLoginResult = { ...tokens, staff: { id, name: 'Jane', email: 'jane@example.com' } };

      authService.login.mockResolvedValue(result);

      expect(await controller.login({ email: 'jane@example.com', password: 'secret-password' })).toBe(result);
      expect(authService.login).toHaveBeenCalledWith({ email: 'jane@example.com', password: 'secret-password' });
    });
  });

  describe('refresh', () => {
    it('delegates with the refresh token', async () => {
      authService.refresh.mockResolvedValue(tokens);

      expect(await controller.refresh({ refreshToken: 'refresh' })).toBe(tokens);
      expect(authService.refresh).toHaveBeenCalledWith('refresh');
    });
  });

  describe('logout', () => {
    it('delegates and resolves void', async () => {
      authService.logout.mockResolvedValue(undefined);

      await expect(controller.logout({ refreshToken: 'refresh' })).resolves.toBeUndefined();
      expect(authService.logout).toHaveBeenCalledWith('refresh');
    });
  });

  describe('me', () => {
    describe('when the staff row exists', () => {
      it('returns the public shape', async () => {
        staffService.findActiveById.mockResolvedValue({
          id,
          name: 'Jane',
          email: 'jane@example.com',
          passwordHash: '$argon2id$x',
        } as StaffRow);

        expect(await controller.me(id)).toEqual({ id, name: 'Jane', email: 'jane@example.com' });
      });
    });

    describe('when the staff row has vanished', () => {
      it('throws invalid_token', async () => {
        staffService.findActiveById.mockResolvedValue(null);

        await expect(controller.me(id)).rejects.toThrow(UnauthorizedException);
        await expect(controller.me(id)).rejects.toThrow('invalid_token');
      });
    });
  });
});
