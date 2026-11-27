import { Injectable } from '@nestjs/common';
import type { BidId } from '../common/ids';
import { StripeGateway } from '../stripe/stripe-gateway';
import { EscrowTransactionDb, type HoldRelease } from './escrow-transaction.db';

@Injectable()
export class EscrowTransactionService {
  constructor(
    private readonly db: EscrowTransactionDb,
    private readonly stripe: StripeGateway,
  ) {}

  async hasActiveAuthorization(bidId: BidId): Promise<boolean> {
    const latest = await this.db.findLatestForBid(bidId);

    return latest?.type === 'AUTHORIZED';
  }

  async releaseHold(release: HoldRelease): Promise<void> {
    await this.stripe.cancelHold(release.paymentIntentId);
    await this.db.recordVoided(release);
  }
}
