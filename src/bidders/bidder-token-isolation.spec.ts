import { Logger, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type MockInstance } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { AuthConfig } from '../auth/auth.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TokenService } from '../auth/token.service';
import type { AthleteId, BidderId, StaffId } from '../common/ids';
import type { StaffAuthConfig } from '../staff-auth/staff-auth.config';
import { StaffTokenService } from '../staff-auth/staff-token.service';
import type { StaffRow } from '../staff-auth/staff.db';
import { StaffGuard } from '../staff-auth/staff.guard';
import type { StaffService } from '../staff-auth/staff.service';
import type { BidderTokenConfig } from './bidder-token.config';
import { BidderTokenService } from './bidder-token.service';

function contextFor(request: object): ExecutionContext {
  const context = mockDeep<ExecutionContext>();
  context.switchToHttp.mockReturnValue({ getRequest: () => request } as never);

  return context;
}

function bearer(token: string): { headers: { authorization: string } } {
  return { headers: { authorization: `Bearer ${token}` } };
}

describe('token isolation between athlete, staff and bidder tokens', () => {
  const athleteId = 'athlete-1' as AthleteId;
  const staffId = 'staff-1' as StaffId;
  const bidderId = 'bidder-1' as BidderId;
  const athleteConfig: AuthConfig = { jwtSecret: 'a'.repeat(32), accessTtlSeconds: 900, refreshTtlSeconds: 3600 };
  const staffConfig: StaffAuthConfig = { accessTtlSeconds: 900, refreshTtlSeconds: 3600 };
  const bidderConfig: BidderTokenConfig = { ttlSeconds: 900 };
  let athleteTokens: TokenService;
  let staffTokens: StaffTokenService;
  let bidderTokens: BidderTokenService;
  let jwtAuthGuard: JwtAuthGuard;
  let staffGuard: StaffGuard;
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    athleteTokens = new TokenService(new JwtService({ secret: athleteConfig.jwtSecret }), athleteConfig);
    staffTokens = new StaffTokenService(new JwtService({ secret: 'b'.repeat(32) }), staffConfig);
    bidderTokens = new BidderTokenService(new JwtService({ secret: 'c'.repeat(32) }), bidderConfig);

    const staffService = mockDeep<StaffService>();

    staffService.findActiveById.mockResolvedValue({ id: staffId, isActive: true, tokensValidAfter: null } as StaffRow);
    jwtAuthGuard = new JwtAuthGuard(athleteTokens);
    staffGuard = new StaffGuard(staffTokens, staffService);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when a bidder token is presented to JwtAuthGuard', () => {
    it('rejects with invalid_token', async () => {
      const { token } = await bidderTokens.issue(bidderId);

      await expect(jwtAuthGuard.canActivate(contextFor(bearer(token)))).rejects.toThrow('invalid_token');
    });
  });

  describe('when a bidder token is presented to StaffGuard', () => {
    it('rejects with invalid_token', async () => {
      const { token } = await bidderTokens.issue(bidderId);

      await expect(staffGuard.canActivate(contextFor(bearer(token)))).rejects.toThrow('invalid_token');
    });
  });

  describe('when an athlete token is presented to BidderTokenService', () => {
    it('rejects with bidder_token_required', async () => {
      const token = await athleteTokens.signAccessToken(athleteId);

      await expect(bidderTokens.verify(token)).rejects.toThrow('bidder_token_required');
    });
  });

  describe('when a staff token is presented to BidderTokenService', () => {
    it('rejects with bidder_token_required', async () => {
      const token = await staffTokens.signAccessToken(staffId);

      await expect(bidderTokens.verify(token)).rejects.toThrow('bidder_token_required');
    });
  });
});
