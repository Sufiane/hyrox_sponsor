import { Module } from '@nestjs/common';
import { EscrowTransactionDb } from './escrow-transaction.db';
import { EscrowTransactionService } from './escrow-transaction.service';

@Module({
  providers: [EscrowTransactionService, EscrowTransactionDb],
  exports: [EscrowTransactionService],
})
export class EscrowModule {}
