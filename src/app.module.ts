import { Module } from '@nestjs/common';
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

@Module({
  imports: [
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
  ],
})
export class AppModule {}
