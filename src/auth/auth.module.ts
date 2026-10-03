import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AthletesModule } from '../athletes/athletes.module';
import type { EnvironmentVariables } from '../config/env.validation';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenDb } from './refresh-token.db';
import { TokenService } from './token.service';

@Module({
  imports: [
    AthletesModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): { secret: string } => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthConfig,
    AuthService,
    TokenService,
    PasswordHasher,
    RefreshTokenDb,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard, TokenService],
})
export class AuthModule {}
