import { Module } from '@nestjs/common';
import { AuctionDb } from './auction.db';
import { AuctionService } from './auction.service';

@Module({
  providers: [AuctionService, AuctionDb],
  exports: [AuctionService],
})
export class AuctionsModule {}
