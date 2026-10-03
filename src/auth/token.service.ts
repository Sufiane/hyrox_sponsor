import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthConfig } from './auth.config';
import type { AthleteId } from '../common/ids';
import { refreshTokenHash, type RefreshTokenHash } from '../common/refresh-token-hash';

const REFRESH_TOKEN_BYTES = 32;

export type CreatedRefreshToken = { token: string; hash: RefreshTokenHash; expiresAt: Date };

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AuthConfig,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.accessTtlSeconds;
  }

  signAccessToken(athleteId: AthleteId): Promise<string> {
    return this.jwt.signAsync(
      { sub: athleteId },
      { algorithm: 'HS256', expiresIn: this.config.accessTtlSeconds },
    );
  }

  async verifyAccessToken(token: string): Promise<AthleteId> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token, { algorithms: ['HS256'] });

      if (typeof payload.sub !== 'string') {
        throw new Error('missing subject');
      }

      return payload.sub as AthleteId;
    } catch (error) {
      this.logger.warn(`Access token rejected: ${error instanceof Error ? error.message : String(error)}`);

      throw new UnauthorizedException('invalid_token');
    }
  }

  createRefreshToken(): CreatedRefreshToken {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.config.refreshTtlSeconds * 1000),
    };
  }

  hashRefreshToken(token: string): RefreshTokenHash {
    return refreshTokenHash(createHash('sha256').update(token).digest('hex'));
  }
}
