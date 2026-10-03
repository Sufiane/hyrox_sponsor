import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AthleteId } from '../common/ids';
import type { AuthenticatedRequest } from './jwt-auth.guard';

export const CurrentAthleteId = createParamDecorator((_data: unknown, context: ExecutionContext): AthleteId | undefined => {
  return context.switchToHttp().getRequest<AuthenticatedRequest>().athleteId;
});
