import { Module } from '@nestjs/common';
import { BidController } from './bid.controller';
import { BidDb } from './bid.db';
import { BidService } from './bid.service';
import { PlaceBidModule } from './usecases/place-bid/place-bid.module';

@Module({
  controllers: [BidController],
  imports: [PlaceBidModule],
  providers: [BidService, BidDb],
  exports: [BidService],
})
export class BidsModule {}
