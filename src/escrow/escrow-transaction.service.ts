import { Injectable } from '@nestjs/common';
import { EscrowTransactionDb } from './escrow-transaction.db.js';

@Injectable()
export class EscrowTransactionService {
  constructor(private readonly db: EscrowTransactionDb) {}

  async hasActiveAuthorization(bidId: string): Promise<boolean> {
    const transaction = await this.db.findActiveAuthorizationForBid(bidId);

    return transaction !== null;
  }
}
