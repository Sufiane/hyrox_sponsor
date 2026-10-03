import { Logger, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';
import type { AthleteId } from '../common/ids';

function contextFor(request: object): ExecutionContext {
  const context = mockDeep<ExecutionContext>();
  context.switchToHttp.mockReturnValue({ getRequest: () => request } as never);

  return context;
}

describe('JwtAuthGuard', () => {
  let tokenService: DeepMockProxy<TokenService>;
  let guard: JwtAuthGuard;
  let warn: MockInstance;

  beforeEach(() => {
    tokenService = mockDeep<TokenService>();
    guard = new JwtAuthGuard(tokenService);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the header is missing', () => {
    it('throws invalid_token', async () => {
      await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow('invalid_token');
    });
  });

  describe('when the scheme is not Bearer', () => {
    it('throws invalid_token', async () => {
      const request = { headers: { authorization: 'Basic abc' } };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow('invalid_token');
    });

    it('does not verify anything', async () => {
      await guard.canActivate(contextFor({ headers: { authorization: 'Basic abc' } })).catch(() => undefined);

      expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('when the token is invalid', () => {
    it('propagates invalid_token', async () => {
      tokenService.verifyAccessToken.mockRejectedValue(new UnauthorizedException('invalid_token'));

      await expect(guard.canActivate(contextFor({ headers: { authorization: 'Bearer bad' } }))).rejects.toThrow(
        'invalid_token',
      );
    });
  });

  describe('when the token is valid', () => {
    const request: { headers: { authorization: string }; athleteId?: AthleteId } = {
      headers: { authorization: 'Bearer good' },
    };

    beforeEach(() => {
      tokenService.verifyAccessToken.mockResolvedValue('athlete-1' as AthleteId);
    });

    it('returns true', async () => {
      expect(await guard.canActivate(contextFor(request))).toBe(true);
    });

    it('sets the athlete id on the request', async () => {
      await guard.canActivate(contextFor(request));

      expect(request.athleteId).toBe('athlete-1');
    });
  });
});
