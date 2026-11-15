import { Module } from '@nestjs/common';
import { StripeModule } from '../../../stripe/stripe.module';
import { BidderTokenModule } from '../../bidder-token.module';
import { CreatePaymentSetupUsecase } from './create-payment-setup.usecase';
import { CreatePaymentSetupUsecaseDb } from './create-payment-setup.usecase.db';

@Module({
  imports: [StripeModule, BidderTokenModule],
  providers: [CreatePaymentSetupUsecase, CreatePaymentSetupUsecaseDb],
  exports: [CreatePaymentSetupUsecase],
})
export class CreatePaymentSetupModule {}
