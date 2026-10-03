import { Module } from '@nestjs/common';
import { BidDb } from './bid.db';
import { BidService } from './bid.service';

@Module({
  providers: [BidService, BidDb],
  exports: [BidService],
})
export class BidsModule {}
