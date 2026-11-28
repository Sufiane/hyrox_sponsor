import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BidderTokenService } from '../../../bidders/bidder-token.service';
import {
  ForbiddenError,
  InvalidValueError,
  NotFoundError,
  PaymentRequiredError,
  UnauthorizedError,
} from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import type { StripeCustomerId, StripePaymentIntentId, StripePaymentMethodId } from '../../../common/stripe-ids';
import { EscrowTransactionService } from '../../../escrow/escrow-transaction.service';
import { StripeGateway, type HoldAuthorization } from '../../../stripe/stripe-gateway';
import { MAX_BID_CENTS } from '../../bid-increment';
import { findBidRuleViolation, type BidRuleInput } from './bid-rules';
import {
  PlaceBidUsecaseDb,
  type ActiveHold,
  type AuthorizedHold,
  type LockedAuction,
  type PlaceBidSession,
  type PlacedBid,
} from './place-bid.usecase.db';

export type PlaceBidInput = { auctionId: AuctionId; bidderToken: string | undefined; amountCents: Cents };

export type CardedBidder = {
  id: BidderId;
  email: NormalizedEmail;
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
};

export type PreviousLeader = { bidId: BidId; bidderId: BidderId; amountCents: Cents; hold: ActiveHold | null };

export type PlaceBidResult = { bid: PlacedBid; closeAt: Date; previousLeader: PreviousLeader | null };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unreleasedNote(previousLeader: PreviousLeader | null): string {
  if (previousLeader === null || previousLeader.hold === null) {
    return '';
  }

  return `; hold ${previousLeader.hold.paymentIntentId} of outbid bid ${previousLeader.bidId} was not released`;
}

@Injectable()
export class PlaceBidUsecase {
  private readonly logger = new Logger(PlaceBidUsecase.name);

  constructor(
    private readonly db: PlaceBidUsecaseDb,
    private readonly tokens: BidderTokenService,
    private readonly stripe: StripeGateway,
    private readonly escrow: EscrowTransactionService,
  ) {}

  async execute(input: PlaceBidInput): Promise<PlaceBidResult> {
    if (input.amountCents > MAX_BID_CENTS) {
      this.logger.warn(`Bid of ${input.amountCents} cents on auction ${input.auctionId} exceeds the maximum`);

      throw new InvalidValueError('bid_above_maximum');
    }

    const bidder = await this.cardedBidder(input.bidderToken);

    await this.preflight(input, bidder);

    const attemptId = randomUUID();
    const hold = await this.authorize(input, bidder, attemptId);
    const result = await this.placeHeld(input, bidder, hold);

    this.logger.log(
      `Bid ${result.bid.id} on auction ${input.auctionId} holds ${hold.paymentIntentId} (attempt ${attemptId})`,
    );

    await this.releasePrevious(result.previousLeader);

    return result;
  }

  private async cardedBidder(rawToken: string | undefined): Promise<CardedBidder> {
    const verified = await this.tokens.verify(rawToken);
    const bidder = await this.db.findBidder(verified.bidderId);

    if (bidder === null) {
      this.logger.warn(`Bidder token presented for unknown bidder ${verified.bidderId}`);

      throw new UnauthorizedError('bidder_token_required');
    }

    this.tokens.assertCurrent(verified, { id: bidder.id, tokenVersion: bidder.tokenVersion });

    if (bidder.stripeCustomerId === null || bidder.defaultPaymentMethodId === null) {
      this.logger.warn(`Bidder ${bidder.id} has no saved card`);

      throw new ForbiddenError('card_required');
    }

    return {
      id: bidder.id,
      email: bidder.email,
      customerId: bidder.stripeCustomerId,
      paymentMethodId: bidder.defaultPaymentMethodId,
    };
  }

  private async preflight(input: PlaceBidInput, bidder: CardedBidder): Promise<void> {
    const snapshot = await this.db.readBiddingSnapshot(input.auctionId);

    if (snapshot === null) {
      this.logger.warn(`Auction ${input.auctionId} not found`);

      throw new NotFoundError('auction_not_found');
    }

    this.assertBiddable(input.auctionId, {
      auction: snapshot.auction,
      leading: snapshot.leading,
      bidder,
      amountCents: input.amountCents,
    });
  }

  private async authorize(input: PlaceBidInput, bidder: CardedBidder, attemptId: string): Promise<AuthorizedHold> {
    const authorization = await this.requestHold(input, bidder, attemptId);

    if (authorization.outcome === 'declined') {
      this.logger.warn(
        `Hold for bidder ${bidder.id} on auction ${input.auctionId} declined (${authorization.reason}, attempt ${attemptId})`,
      );

      throw new PaymentRequiredError('card_declined');
    }

    if (authorization.outcome === 'payment_method_unusable') {
      this.logger.warn(`Saved card of bidder ${bidder.id} is unusable (${authorization.reason}, attempt ${attemptId})`);

      throw new ForbiddenError('card_required');
    }

    return {
      paymentIntentId: authorization.paymentIntentId,
      amountCents: input.amountCents,
      captureBefore: authorization.captureBefore,
    };
  }

  private async requestHold(input: PlaceBidInput, bidder: CardedBidder, attemptId: string): Promise<HoldAuthorization> {
    try {
      return await this.stripe.authorizeHold({
        customerId: bidder.customerId,
        paymentMethodId: bidder.paymentMethodId,
        amountCents: input.amountCents,
        auctionId: input.auctionId,
        bidderId: bidder.id,
        attemptId,
      });
    } catch (error) {
      this.logger.error(
        `Hold authorization failed for attempt ${attemptId} (auction ${input.auctionId}, bidder ${bidder.id}): ${describeError(error)}`,
      );

      throw error;
    }
  }

  private async placeHeld(input: PlaceBidInput, bidder: CardedBidder, hold: AuthorizedHold): Promise<PlaceBidResult> {
    const attempt: { placed: PlaceBidResult | null } = { placed: null };

    try {
      const result = await this.db.withLockedAuction(input.auctionId, async (auction, session) => {
        attempt.placed = await this.place(input, bidder, hold, auction, session);

        return attempt.placed;
      });

      if (result === null) {
        this.logger.warn(`Auction ${input.auctionId} not found`);

        throw new NotFoundError('auction_not_found');
      }

      return result;
    } catch (error) {
      const recovered = await this.recoverFailedPlacement(hold.paymentIntentId, attempt.placed, error);

      if (recovered !== null) {
        return recovered;
      }

      throw error;
    }
  }

  private async recoverFailedPlacement(
    paymentIntentId: StripePaymentIntentId,
    placed: PlaceBidResult | null,
    failure: unknown,
  ): Promise<PlaceBidResult | null> {
    if (placed === null) {
      await this.cancelUnplacedHold(paymentIntentId);

      return null;
    }

    const bidId = placed.bid.id;
    let committed: boolean;

    try {
      committed = await this.db.bidExists(bidId);
    } catch (lookupError) {
      this.logger.error(
        `Commit of bid ${bidId} is unknown after "${describeError(failure)}" and the lookup failed (${describeError(lookupError)}); hold ${paymentIntentId} kept${unreleasedNote(placed.previousLeader)}`,
      );

      return null;
    }

    if (committed) {
      this.logger.warn(
        `Bid ${bidId} committed although the transaction reported "${describeError(failure)}"; hold ${paymentIntentId} kept`,
      );

      return placed;
    }

    await this.cancelUnplacedHold(paymentIntentId);

    return null;
  }

  private async cancelUnplacedHold(paymentIntentId: StripePaymentIntentId): Promise<void> {
    try {
      await this.stripe.cancelHold(paymentIntentId);
    } catch (error) {
      this.logger.error(`Hold ${paymentIntentId} for a rejected bid was not canceled: ${describeError(error)}`);
    }
  }

  private async releasePrevious(previousLeader: PreviousLeader | null): Promise<void> {
    if (previousLeader === null || previousLeader.hold === null) {
      return;
    }

    const { hold } = previousLeader;

    try {
      await this.escrow.releaseHold({
        bidId: previousLeader.bidId,
        paymentIntentId: hold.paymentIntentId,
        amountCents: hold.amountCents,
      });
    } catch (error) {
      this.logger.error(
        `Hold ${hold.paymentIntentId} of outbid bid ${previousLeader.bidId} was not released: ${describeError(error)}`,
      );
    }
  }

  private async place(
    input: PlaceBidInput,
    bidder: CardedBidder,
    hold: AuthorizedHold,
    auction: LockedAuction,
    session: PlaceBidSession,
  ): Promise<PlaceBidResult> {
    const leading = await session.findLeading();

    this.assertBiddable(input.auctionId, { auction, leading, bidder, amountCents: input.amountCents });

    if (leading !== null) {
      // The partial unique index allows one LEADING bid per auction, so demote before inserting.
      await session.markOutbid(leading.id);
    }

    const bid = await session.insertLeading(bidder.id, input.amountCents);

    await session.recordAuthorized(bid.id, hold);

    return {
      bid,
      closeAt: auction.closeAt,
      previousLeader:
        leading === null
          ? null
          : { bidId: leading.id, bidderId: leading.bidderId, amountCents: leading.amountCents, hold: leading.hold },
    };
  }

  private assertBiddable(auctionId: AuctionId, rules: BidRuleInput): void {
    const violation = findBidRuleViolation(rules);

    if (violation !== null) {
      this.logger.warn(`Bid on auction ${auctionId} refused: ${violation.detail}`);

      throw violation.error;
    }
  }
}
