import { Logger, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { StaffId } from '../common/ids';
import { StaffTokenService } from './staff-token.service';
import type { StaffRow } from './staff.db';
import { StaffGuard } from './staff.guard';
import { StaffService } from './staff.service';

function contextFor(request: object): ExecutionContext {
  const context = mockDeep<ExecutionContext>();
  context.switchToHttp.mockReturnValue({ getRequest: () => request } as never);

  return context;
}

const id = 'staff-1' as StaffId;
const ISSUED_AT = 1_791_000_000;

function activeStaff(tokensValidAfter: Date | null): StaffRow {
  return { id, isActive: true, tokensValidAfter } as StaffRow;
}

describe('StaffGuard', () => {
  let tokenService: DeepMockProxy<StaffTokenService>;
  let staffService: DeepMockProxy<StaffService>;
  let guard: StaffGuard;
  let warn: MockInstance;

  beforeEach(() => {
    tokenService = mockDeep<StaffTokenService>();
    staffService = mockDeep<StaffService>();
    guard = new StaffGuard(tokenService, staffService);
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
    it('throws invalid_token without verifying', async () => {
      const request = { headers: { authorization: 'Basic abc' } };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow('invalid_token');
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

  describe('when the token is well formed', () => {
    const request = (): { headers: { authorization: string }; staffId?: StaffId } => ({
      headers: { authorization: 'Bearer good' },
    });

    beforeEach(() => {
      tokenService.verifyAccessToken.mockResolvedValue({ staffId: id, issuedAt: ISSUED_AT });
    });

    describe('when the staff row is missing', () => {
      it('throws invalid_token', async () => {
        staffService.findActiveById.mockResolvedValue(null);

        await expect(guard.canActivate(contextFor(request()))).rejects.toThrow('invalid_token');
        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when the staff is inactive', () => {
      it('throws invalid_token', async () => {
        staffService.findActiveById.mockResolvedValue(null);

        await expect(guard.canActivate(contextFor(request()))).rejects.toThrow('invalid_token');
      });
    });

    describe('when the token was issued before tokensValidAfter', () => {
      it('throws invalid_token', async () => {
        staffService.findActiveById.mockResolvedValue(activeStaff(new Date((ISSUED_AT + 5) * 1000)));

        await expect(guard.canActivate(contextFor(request()))).rejects.toThrow('invalid_token');
        expect(warn).toHaveBeenCalled();
      });
    });

    describe('when tokensValidAfter is null', () => {
      it('allows the request', async () => {
        staffService.findActiveById.mockResolvedValue(activeStaff(null));

        expect(await guard.canActivate(contextFor(request()))).toBe(true);
      });
    });

    describe('when the token was issued in the same second as tokensValidAfter', () => {
      it('throws invalid_token', async () => {
        staffService.findActiveById.mockResolvedValue(activeStaff(new Date(ISSUED_AT * 1000 + 999)));

        await expect(guard.canActivate(contextFor(request()))).rejects.toThrow('invalid_token');
      });
    });

    describe('when the token was issued the second after tokensValidAfter', () => {
      it('allows the request', async () => {
        staffService.findActiveById.mockResolvedValue(activeStaff(new Date((ISSUED_AT - 1) * 1000 + 999)));

        expect(await guard.canActivate(contextFor(request()))).toBe(true);
      });
    });

    describe('when the staff is active', () => {
      it('returns true and sets the staff id on the request', async () => {
        const current = request();

        staffService.findActiveById.mockResolvedValue(activeStaff(new Date((ISSUED_AT - 60) * 1000)));

        expect(await guard.canActivate(contextFor(current))).toBe(true);
        expect(current.staffId).toBe(id);
      });
    });
  });
});
