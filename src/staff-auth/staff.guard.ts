import { Injectable, Logger, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { StaffId } from '../common/ids';
import { StaffTokenService } from './staff-token.service';
import { StaffService } from './staff.service';

export type StaffAuthenticatedRequest = Request & { staffId?: StaffId };

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class StaffGuard implements CanActivate {
  private readonly logger = new Logger(StaffGuard.name);

  constructor(
    private readonly tokenService: StaffTokenService,
    private readonly staffService: StaffService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffAuthenticatedRequest>();
    const header = request.headers.authorization;

    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      this.logger.warn('Staff request rejected: missing or non-Bearer authorization header');

      throw new UnauthorizedException('invalid_token');
    }

    const { staffId, issuedAt } = await this.tokenService.verifyAccessToken(header.slice(BEARER_PREFIX.length));
    const staff = await this.staffService.findActiveById(staffId);

    if (!staff) {
      this.logger.warn(`Staff request rejected: staff ${staffId} missing or inactive`);

      throw new UnauthorizedException('invalid_token');
    }

    // <= on purpose: iat has second precision, so a token minted in the revocation second must be rejected
    if (staff.tokensValidAfter != null && issuedAt <=Math.floor(staff.tokensValidAfter.getTime() / 1000)) {
      this.logger.warn(`Staff request rejected: token for staff ${staffId} is not newer than tokensValidAfter`);

      throw new UnauthorizedException('invalid_token');
    }

    request.staffId = staffId;

    return true;
  }
}
