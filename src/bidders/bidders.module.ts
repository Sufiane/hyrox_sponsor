import { Module } from '@nestjs/common';
import { BidderTokenModule } from './bidder-token.module';
import { BidderDb } from './bidder.db';
import { BidderService } from './bidder.service';

@Module({
  imports: [BidderTokenModule],
  providers: [BidderService, BidderDb],
  exports: [BidderService, BidderTokenModule],
})
export class BiddersModule {}
