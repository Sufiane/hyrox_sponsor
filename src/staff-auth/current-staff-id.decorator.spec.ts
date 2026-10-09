import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { mockDeep } from 'vitest-mock-extended';
import type { StaffId } from '../common/ids';
import { extractStaffId } from './current-staff-id.decorator';

function contextFor(request: object): ExecutionContext {
  const context = mockDeep<ExecutionContext>();
  context.switchToHttp.mockReturnValue({ getRequest: () => request } as never);

  return context;
}

describe('extractStaffId', () => {
  describe('when the guard set the staff id', () => {
    it('returns it', () => {
      expect(extractStaffId(contextFor({ staffId: 'staff-1' as StaffId }))).toBe('staff-1');
    });
  });

  describe('when the staff id is absent', () => {
    it('throws invalid_token', () => {
      expect(() => extractStaffId(contextFor({}))).toThrow(UnauthorizedException);
      expect(() => extractStaffId(contextFor({}))).toThrow('invalid_token');
    });
  });
});
