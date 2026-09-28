import { Module } from '@nestjs/common';
import { AuctionDb } from './auction.db.js';
import { AuctionService } from './auction.service.js';

@Module({
  providers: [AuctionService, AuctionDb],
  exports: [AuctionService],
})
export class AuctionsModule {}
