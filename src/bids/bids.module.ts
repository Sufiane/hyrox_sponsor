import { Module } from '@nestjs/common';
import { BidDb } from './bid.db.js';
import { BidService } from './bid.service.js';

@Module({
  providers: [BidService, BidDb],
  exports: [BidService],
})
export class BidsModule {}
