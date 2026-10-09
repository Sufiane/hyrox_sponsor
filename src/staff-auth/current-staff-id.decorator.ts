import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { StaffId } from '../common/ids';
import type { StaffAuthenticatedRequest } from './staff.guard';

export function extractStaffId(context: ExecutionContext): StaffId {
  const staffId = context.switchToHttp().getRequest<StaffAuthenticatedRequest>().staffId;

  if (staffId === undefined) {
    throw new UnauthorizedException('invalid_token');
  }

  return staffId;
}

export const CurrentStaffId = createParamDecorator((_data: unknown, context: ExecutionContext): StaffId =>
  extractStaffId(context),
);
