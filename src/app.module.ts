import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AthletesModule } from './athletes/athletes.module';
import { BiddersModule } from './bidders/bidders.module';
import { ZonesModule } from './zones/zones.module';
import { RacesModule } from './races/races.module';
import { AuctionsModule } from './auctions/auctions.module';
import { BidsModule } from './bids/bids.module';
import { EscrowModule } from './escrow/escrow.module';
import { ProofsModule } from './proofs/proofs.module';
import { DisputesModule } from './disputes/disputes.module';
import { TrustModule } from './trust/trust.module';
import { AuthModule } from './auth/auth.module';
import { StaffAuthModule } from './staff-auth/staff-auth.module';
import { DomainErrorFilter } from './common/domain-error.filter';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AthletesModule,
    BiddersModule,
    ZonesModule,
    RacesModule,
    AuctionsModule,
    BidsModule,
    EscrowModule,
    ProofsModule,
    DisputesModule,
    TrustModule,
    AuthModule,
    StaffAuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
