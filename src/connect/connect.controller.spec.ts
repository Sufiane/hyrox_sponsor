import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UnauthorizedException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AthleteId } from '../common/ids';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';

describe('ConnectController', () => {
  const athleteId = 'athlete-1' as AthleteId;
  let service: DeepMockProxy<ConnectService>;
  let controller: ConnectController;

  beforeEach(() => {
    service = mockDeep<ConnectService>();
    controller = new ConnectController(service);
  });

  it('is guarded by JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ConnectController)).toEqual([JwtAuthGuard]);
  });

  describe('createOnboardingLink', () => {
    describe('when the athlete id is undefined', () => {
      it('throws UnauthorizedException', async () => {
        await expect(controller.createOnboardingLink(undefined)).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('when the athlete is authenticated', () => {
      it('returns only url and expiresAt for the token athlete', async () => {
        const expiresAt = new Date('2026-11-10T12:05:00Z');

        service.createOnboardingLink.mockResolvedValue({ url: 'https://connect.stripe.test/x', expiresAt });

        await expect(controller.createOnboardingLink(athleteId)).resolves.toEqual({
          url: 'https://connect.stripe.test/x',
          expiresAt,
        });
        expect(service.createOnboardingLink).toHaveBeenCalledWith(athleteId);
      });
    });
  });

  describe('getStatus', () => {
    describe('when the athlete id is undefined', () => {
      it('throws UnauthorizedException', async () => {
        await expect(controller.getStatus(undefined)).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('when the athlete is authenticated', () => {
      it('wraps the status for the token athlete', async () => {
        service.getStatus.mockResolvedValue({ status: 'READY', requirementsDue: [] });

        await expect(controller.getStatus(athleteId)).resolves.toEqual({ status: 'READY', requirementsDue: [] });
        expect(service.getStatus).toHaveBeenCalledWith(athleteId);
      });
    });
  });
});
