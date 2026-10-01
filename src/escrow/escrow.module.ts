import { Module } from '@nestjs/common';
import { EscrowTransactionDb } from './escrow-transaction.db.js';
import { EscrowTransactionService } from './escrow-transaction.service.js';

@Module({
  providers: [EscrowTransactionService, EscrowTransactionDb],
  exports: [EscrowTransactionService],
})
export class EscrowModule {}
