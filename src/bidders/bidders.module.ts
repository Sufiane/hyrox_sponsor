import { Module } from '@nestjs/common';
import { BidderTokenModule } from './bidder-token.module';
import { BidderDb } from './bidder.db';
import { BidderService } from './bidder.service';
import { CreatePaymentSetupModule } from './usecases/create-payment-setup/create-payment-setup.module';

@Module({
  imports: [BidderTokenModule, CreatePaymentSetupModule],
  providers: [BidderService, BidderDb],
  exports: [BidderService, BidderTokenModule],
})
export class BiddersModule {}
