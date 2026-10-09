import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import type { EnvironmentVariables } from '../config/env.validation';
import { StaffAuthConfig } from './staff-auth.config';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffRefreshTokenDb } from './staff-refresh-token.db';
import { StaffTokenService } from './staff-token.service';
import { StaffDb } from './staff.db';
import { StaffGuard } from './staff.guard';
import { StaffService } from './staff.service';

@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): { secret: string } => ({
        secret: config.get('STAFF_JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [StaffAuthController],
  providers: [
    StaffAuthConfig,
    StaffDb,
    StaffRefreshTokenDb,
    StaffService,
    StaffTokenService,
    StaffAuthService,
    StaffGuard,
  ],
  exports: [StaffGuard, StaffTokenService, StaffService],
})
export class StaffAuthModule {}
