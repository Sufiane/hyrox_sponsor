import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/env.validation';
import { BidderTokenConfig } from './bidder-token.config';
import { BidderTokenService } from './bidder-token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): { secret: string } => ({
        secret: config.get('BIDDER_JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  providers: [BidderTokenConfig, BidderTokenService],
  exports: [BidderTokenService],
})
export class BidderTokenModule {}
