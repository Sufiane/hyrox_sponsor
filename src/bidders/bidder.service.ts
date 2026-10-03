import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { normalizeEmail } from '../common/email';
import type { BidderId } from '../common/ids';
import type { StripeCustomerId } from '../common/stripe-ids';
import { BidderDb } from './bidder.db';

type BidderRecord = Awaited<ReturnType<BidderDb['upsertByEmail']>>;

@Injectable()
export class BidderService {
  private readonly logger = new Logger(BidderService.name);

  constructor(private readonly db: BidderDb) {}

  async getOrCreateByEmail(rawEmail: string): Promise<BidderRecord> {
    return this.db.upsertByEmail(normalizeEmail(rawEmail));
  }

  async getById(id: BidderId): Promise<BidderRecord> {
    const bidder = await this.db.findById(id);

    if (!bidder) {
      this.throwNotFound(id);
    }

    return bidder;
  }

  async attachStripeCustomer(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<BidderRecord> {
    const bidder = await this.getById(id);

    if (bidder.stripeCustomerId === stripeCustomerId) {
      return bidder;
    }

    if (bidder.stripeCustomerId != null) {
      this.throwStripeConflict(id, bidder.stripeCustomerId, stripeCustomerId);
    }

    const updated = await this.db.setStripeCustomerIdIfUnset(id, stripeCustomerId);

    if (!updated || updated.stripeCustomerId == null) {
      this.throwNotFound(id);
    }

    if (updated.stripeCustomerId !== stripeCustomerId) {
      this.throwStripeConflict(id, updated.stripeCustomerId, stripeCustomerId);
    }

    return updated;
  }

  private throwNotFound(id: BidderId): never {
    this.logger.warn(`Bidder ${id} not found`);

    throw new NotFoundException('bidder_not_found');
  }

  private throwStripeConflict(id: BidderId, existing: string, requested: StripeCustomerId): never {
    this.logger.warn(`Bidder ${id} already linked to Stripe customer ${existing}, refused ${requested}`);

    throw new ConflictException('bidder_stripe_customer_conflict');
  }
}
