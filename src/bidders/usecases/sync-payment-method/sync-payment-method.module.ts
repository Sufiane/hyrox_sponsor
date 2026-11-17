import { Module } from '@nestjs/common';
import { StripeModule } from '../../../stripe/stripe.module';
import { SyncPaymentMethodUsecase } from './sync-payment-method.usecase';
import { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

@Module({
  imports: [StripeModule],
  providers: [SyncPaymentMethodUsecase, SyncPaymentMethodUsecaseDb],
  exports: [SyncPaymentMethodUsecase],
})
export class SyncPaymentMethodModule {}
