import { Injectable } from '@nestjs/common';
import type { BidId } from '../common/index.js';
import { EscrowTransactionDb } from './escrow-transaction.db.js';

@Injectable()
export class EscrowTransactionService {
  constructor(private readonly db: EscrowTransactionDb) {}

  async hasActiveAuthorization(bidId: BidId): Promise<boolean> {
    const latest = await this.db.findLatestForBid(bidId);

    return latest?.type === 'AUTHORIZED';
  }
}
