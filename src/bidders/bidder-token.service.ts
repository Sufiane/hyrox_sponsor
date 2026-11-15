import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { bidderToken, type BidderToken } from '../common/bidder-token';
import { bidderId, type BidderId } from '../common/ids';
import { BidderTokenConfig } from './bidder-token.config';

const BIDDER_AUDIENCE = 'hyrox-bidder';
const TOKEN_ISSUER = 'hyrox-api';
const MILLIS_PER_SECOND = 1000;

export type IssuedBidderToken = { token: BidderToken; expiresAt: Date };

@Injectable()
export class BidderTokenService {
  private readonly logger = new Logger(BidderTokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: BidderTokenConfig,
  ) {}

  async issue(id: BidderId): Promise<IssuedBidderToken> {
    const signed = await this.jwt.signAsync(
      { sub: id },
      { algorithm: 'HS256', expiresIn: this.config.ttlSeconds, audience: BIDDER_AUDIENCE, issuer: TOKEN_ISSUER },
    );

    return {
      token: bidderToken(signed),
      expiresAt: new Date(Date.now() + this.config.ttlSeconds * MILLIS_PER_SECOND),
    };
  }

  async verify(raw: string | undefined): Promise<BidderId> {
    if (raw === undefined || raw.trim() === '') {
      throw this.reject('missing token');
    }

    const payload = await this.decode(raw.trim());

    if (typeof payload.sub !== 'string') {
      throw this.reject('missing subject');
    }

    try {
      return bidderId(payload.sub);
    } catch (error) {
      throw this.reject(error instanceof Error ? error.message : String(error));
    }
  }

  private async decode(token: string): Promise<{ sub?: unknown }> {
    try {
      return await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
        algorithms: ['HS256'],
        audience: BIDDER_AUDIENCE,
        issuer: TOKEN_ISSUER,
      });
    } catch (error) {
      throw this.reject(error instanceof Error ? error.message : String(error));
    }
  }

  private reject(reason: string): UnauthorizedException {
    this.logger.warn(`Bidder token rejected: ${reason}`);

    return new UnauthorizedException('bidder_token_required');
  }
}
