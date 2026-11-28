import { Module } from '@nestjs/common';
import { BidderTokenModule } from '../../../bidders/bidder-token.module';
import { PlaceBidUsecase } from './place-bid.usecase';
import { PlaceBidUsecaseDb } from './place-bid.usecase.db';

@Module({
  imports: [BidderTokenModule],
  providers: [PlaceBidUsecase, PlaceBidUsecaseDb],
  exports: [PlaceBidUsecase],
})
export class PlaceBidModule {}
