import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AthletesModule } from './athletes/athletes.module.js';
import { BiddersModule } from './bidders/bidders.module.js';
import { ZonesModule } from './zones/zones.module.js';
import { RacesModule } from './races/races.module.js';
import { AuctionsModule } from './auctions/auctions.module.js';
import { BidsModule } from './bids/bids.module.js';
import { EscrowModule } from './escrow/escrow.module.js';
import { ProofsModule } from './proofs/proofs.module.js';
import { DisputesModule } from './disputes/disputes.module.js';
import { TrustModule } from './trust/trust.module.js';

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
