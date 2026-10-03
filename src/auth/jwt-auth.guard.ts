import { Injectable, Logger, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AthleteId } from '../common/ids';
import { TokenService } from './token.service';

export type AuthenticatedRequest = Request & { athleteId?: AthleteId };

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly tokenService: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      this.logger.warn('Request rejected: missing or non-Bearer authorization header');

      throw new UnauthorizedException('invalid_token');
    }

    request.athleteId = await this.tokenService.verifyAccessToken(header.slice(BEARER_PREFIX.length));

    return true;
  }
}
