import { Module } from '@nestjs/common';
import { BidderDb } from './bidder.db';
import { BidderService } from './bidder.service';

@Module({
  providers: [BidderService, BidderDb],
  exports: [BidderService],
})
export class BiddersModule {}
