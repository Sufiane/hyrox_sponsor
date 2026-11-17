import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { BidderTokenModule } from './bidder-token.module';
import { BidderController } from './bidder.controller';
import { BidderDb } from './bidder.db';
import { BidderService } from './bidder.service';
import { SetupIntentSucceededHandler } from './setup-intent-succeeded.handler';
import { CreatePaymentSetupModule } from './usecases/create-payment-setup/create-payment-setup.module';
import { SyncPaymentMethodModule } from './usecases/sync-payment-method/sync-payment-method.module';

@Module({
  controllers: [BidderController],
  imports: [BidderTokenModule, StripeModule, CreatePaymentSetupModule, SyncPaymentMethodModule],
  providers: [BidderService, BidderDb, SetupIntentSucceededHandler],
  exports: [BidderService, BidderTokenModule],
})
export class BiddersModule {}
