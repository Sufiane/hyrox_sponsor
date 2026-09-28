import { Module } from '@nestjs/common';
import { BidderDb } from './bidder.db.js';
import { BidderService } from './bidder.service.js';

@Module({
  providers: [BidderService, BidderDb],
  exports: [BidderService],
})
export class BiddersModule {}
