import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';

@Injectable()
export class BidderTokenConfig {
  readonly ttlSeconds: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.ttlSeconds = config.get('BIDDER_TOKEN_TTL_SECONDS', { infer: true });
  }
}
