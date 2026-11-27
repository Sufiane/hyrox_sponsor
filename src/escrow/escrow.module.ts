import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { EscrowTransactionDb } from './escrow-transaction.db';
import { EscrowTransactionService } from './escrow-transaction.service';

@Module({
  imports: [StripeModule],
  providers: [EscrowTransactionService, EscrowTransactionDb],
  exports: [EscrowTransactionService],
})
export class EscrowModule {}
