import { Logger, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type MockInstance } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { AuthConfig } from '../auth/auth.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TokenService } from '../auth/token.service';
import type { AthleteId, StaffId } from '../common/ids';
import type { StaffAuthConfig } from './staff-auth.config';
import { StaffTokenService } from './staff-token.service';
import type { StaffRow } from './staff.db';
import { StaffGuard } from './staff.guard';
import { StaffService } from './staff.service';

function contextFor(request: object): ExecutionContext {
  const context = mockDeep<ExecutionContext>();
  context.switchToHttp.mockReturnValue({ getRequest: () => request } as never);

  return context;
}

function bearer(token: string): { headers: { authorization: string }; staffId?: StaffId; athleteId?: AthleteId } {
  return { headers: { authorization: `Bearer ${token}` } };
}

describe('token isolation between athlete and staff guards', () => {
  const staffId = 'staff-1' as StaffId;
  const athleteId = 'athlete-1' as AthleteId;
  const athleteConfig: AuthConfig = { jwtSecret: 'a'.repeat(32), accessTtlSeconds: 900, refreshTtlSeconds: 3600 };
  const staffSecret = 'b'.repeat(32);
  const staffConfig: StaffAuthConfig = { accessTtlSeconds: 900, refreshTtlSeconds: 3600 };
  let athleteTokens: TokenService;
  let staffTokens: StaffTokenService;
  let jwtAuthGuard: JwtAuthGuard;
  let staffGuard: StaffGuard;
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    athleteTokens = new TokenService(new JwtService({ secret: athleteConfig.jwtSecret }), athleteConfig);
    staffTokens = new StaffTokenService(new JwtService({ secret: staffSecret }), staffConfig);

    const staffService = mockDeep<StaffService>();

    staffService.findActiveById.mockResolvedValue({ id: staffId, isActive: true, tokensValidAfter: null } as StaffRow);
    jwtAuthGuard = new JwtAuthGuard(athleteTokens);
    staffGuard = new StaffGuard(staffTokens, staffService);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when an athlete token is presented to StaffGuard', () => {
    it('rejects with invalid_token', async () => {
      const token = await athleteTokens.signAccessToken(athleteId);

      await expect(staffGuard.canActivate(contextFor(bearer(token)))).rejects.toThrow('invalid_token');
    });
  });

  describe('when a staff token is presented to JwtAuthGuard', () => {
    it('rejects with invalid_token', async () => {
      const token = await staffTokens.signAccessToken(staffId);

      await expect(jwtAuthGuard.canActivate(contextFor(bearer(token)))).rejects.toThrow('invalid_token');
    });
  });

  describe('when each guard gets its own token type', () => {
    it('sets staffId on the staff request', async () => {
      const request = bearer(await staffTokens.signAccessToken(staffId));

      expect(await staffGuard.canActivate(contextFor(request))).toBe(true);
      expect(request.staffId).toBe(staffId);
    });

    it('sets athleteId on the athlete request', async () => {
      const request = bearer(await athleteTokens.signAccessToken(athleteId));

      expect(await jwtAuthGuard.canActivate(contextFor(request))).toBe(true);
      expect(request.athleteId).toBe(athleteId);
    });
  });
});
