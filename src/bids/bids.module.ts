import { Module } from '@nestjs/common';
import { BidDb } from './bid.db';
import { BidService } from './bid.service';
import { PlaceBidModule } from './usecases/place-bid/place-bid.module';

@Module({
  imports: [PlaceBidModule],
  providers: [BidService, BidDb],
  exports: [BidService],
})
export class BidsModule {}
