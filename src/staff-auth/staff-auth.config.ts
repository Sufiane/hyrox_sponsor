import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';

@Injectable()
export class StaffAuthConfig {
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.accessTtlSeconds = config.get('STAFF_JWT_TTL_SECONDS', { infer: true });
    this.refreshTtlSeconds = config.get('STAFF_REFRESH_TOKEN_TTL_SECONDS', { infer: true });
  }
}
