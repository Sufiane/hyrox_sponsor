import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BidderToken } from '../../../common/bidder-token';
import { normalizeEmail, type NormalizedEmail } from '../../../common/email';
import { bidderId, type BidderId } from '../../../common/ids';
import { stripeCustomerId, type StripeCustomerId } from '../../../common/stripe-ids';
import { StripeGateway } from '../../../stripe/stripe-gateway';
import { BidderTokenService } from '../../bidder-token.service';
import { CreatePaymentSetupUsecaseDb } from './create-payment-setup.usecase.db';

type BidderRecord = Awaited<ReturnType<CreatePaymentSetupUsecaseDb['upsertByEmail']>>;

export type CreatePaymentSetupInput = { email: string; bidderToken: string | undefined };

export type CreatePaymentSetupResult = {
  clientSecret: string;
  bidderToken: BidderToken;
  bidderTokenExpiresAt: Date;
};

@Injectable()
export class CreatePaymentSetupUsecase {
  private readonly logger = new Logger(CreatePaymentSetupUsecase.name);

  constructor(
    private readonly db: CreatePaymentSetupUsecaseDb,
    private readonly stripe: StripeGateway,
    private readonly tokens: BidderTokenService,
  ) {}

  async execute(input: CreatePaymentSetupInput): Promise<CreatePaymentSetupResult> {
    const email = normalizeEmail(input.email);
    const bidder = await this.db.upsertByEmail(email);
    const id = bidderId(bidder.id);

    if (bidder.defaultPaymentMethodId != null) {
      await this.requireOwnership(bidder, input.bidderToken);
    }

    const customerId = await this.ensureCustomer(id, email, bidder);
    const setupIntent = await this.stripe.createSetupIntent(customerId);
    const current = await this.recheckCard(bidder, input.bidderToken);
    const issued = await this.tokens.issue(id, current.tokenVersion);

    return {
      clientSecret: setupIntent.clientSecret,
      bidderToken: issued.token,
      bidderTokenExpiresAt: issued.expiresAt,
    };
  }

  private async recheckCard(initial: BidderRecord, rawToken: string | undefined): Promise<BidderRecord> {
    const id = bidderId(initial.id);
    const current = await this.db.findById(id);

    if (current === null) {
      this.logger.warn(`Bidder ${id} disappeared while creating a setup intent`);

      throw new NotFoundException('bidder_not_found');
    }

    const ownershipUnverified = initial.defaultPaymentMethodId == null || current.tokenVersion !== initial.tokenVersion;

    if (current.defaultPaymentMethodId != null && ownershipUnverified) {
      await this.requireOwnership(current, rawToken);
    }

    return current;
  }

  private async requireOwnership(bidder: BidderRecord, rawToken: string | undefined): Promise<void> {
    const verified = await this.tokens.verify(rawToken);

    this.tokens.assertCurrent(verified, { id: bidderId(bidder.id), tokenVersion: bidder.tokenVersion });
  }

  private async ensureCustomer(id: BidderId, email: NormalizedEmail, bidder: BidderRecord): Promise<StripeCustomerId> {
    if (bidder.stripeCustomerId != null) {
      return stripeCustomerId(bidder.stripeCustomerId);
    }

    const created = await this.stripe.createCustomer({ bidderId: id, email });
    const stored = await this.db.setStripeCustomerIdIfUnset(id, created);

    if (stored === null) {
      this.logger.warn(`Bidder ${id} disappeared while attaching Stripe customer ${created}`);

      throw new NotFoundException('bidder_not_found');
    }

    if (stored.stripeCustomerId !== created) {
      this.logger.warn(`Bidder ${id} already has Stripe customer ${stored.stripeCustomerId}, not ${created}`);

      throw new ConflictException('bidder_stripe_customer_conflict');
    }

    return created;
  }
}
