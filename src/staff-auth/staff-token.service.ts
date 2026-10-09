import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { staffId, type StaffId } from '../common/ids';
import { refreshTokenHash, type RefreshTokenHash } from '../common/refresh-token-hash';
import { StaffAuthConfig } from './staff-auth.config';

const REFRESH_TOKEN_BYTES = 32;
const STAFF_AUDIENCE = 'hyrox-staff';
const TOKEN_ISSUER = 'hyrox-api';

export type CreatedStaffRefreshToken = { token: string; hash: RefreshTokenHash; expiresAt: Date };

@Injectable()
export class StaffTokenService {
  private readonly logger = new Logger(StaffTokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: StaffAuthConfig,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.accessTtlSeconds;
  }

  signAccessToken(id: StaffId): Promise<string> {
    return this.jwt.signAsync(
      { sub: id },
      {
        algorithm: 'HS256',
        expiresIn: this.config.accessTtlSeconds,
        audience: STAFF_AUDIENCE,
        issuer: TOKEN_ISSUER,
      },
    );
  }

  async verifyAccessToken(token: string): Promise<{ staffId: StaffId; issuedAt: number }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown; iat?: unknown }>(token, {
        algorithms: ['HS256'],
        audience: STAFF_AUDIENCE,
        issuer: TOKEN_ISSUER,
      });

      if (typeof payload.sub !== 'string' || typeof payload.iat !== 'number') {
        throw new Error('missing subject or issue time');
      }

      return { staffId: staffId(payload.sub), issuedAt: payload.iat };
    } catch (error) {
      this.logger.warn(`Staff access token rejected: ${error instanceof Error ? error.message : String(error)}`);

      throw new UnauthorizedException('invalid_token');
    }
  }

  createRefreshToken(): CreatedStaffRefreshToken {
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
