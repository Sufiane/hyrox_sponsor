import { Module } from '@nestjs/common';
import { BidderTokenModule } from '../../../bidders/bidder-token.module';
import { EscrowModule } from '../../../escrow/escrow.module';
import { StripeModule } from '../../../stripe/stripe.module';
import { PlaceBidUsecase } from './place-bid.usecase';
import { PlaceBidUsecaseDb } from './place-bid.usecase.db';

@Module({
  imports: [BidderTokenModule, StripeModule, EscrowModule],
  providers: [PlaceBidUsecase, PlaceBidUsecaseDb],
  exports: [PlaceBidUsecase],
})
export class PlaceBidModule {}
