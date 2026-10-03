import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';

@Injectable()
export class AuthConfig {
  readonly jwtSecret: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.jwtSecret = config.get('JWT_SECRET', { infer: true });
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlSeconds = config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true });
  }
}
