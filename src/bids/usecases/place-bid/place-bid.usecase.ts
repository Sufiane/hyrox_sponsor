import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, ForbiddenError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { MAX_BID_CENTS, minimumNextBidCents } from '../../bid-increment';
import {
  PlaceBidUsecaseDb,
  type LockedAuction,
  type PlaceBidSession,
  type PlacedBid,
} from './place-bid.usecase.db';

export type PlaceBidInput = { auctionId: AuctionId; email: NormalizedEmail; amountCents: Cents };

export type PreviousLeader = { bidId: BidId; bidderId: BidderId; amountCents: Cents };

export type PlaceBidResult = { bid: PlacedBid; previousLeader: PreviousLeader | null };

@Injectable()
export class PlaceBidUsecase {
  private readonly logger = new Logger(PlaceBidUsecase.name);

  constructor(private readonly db: PlaceBidUsecaseDb) {}

  async execute(input: PlaceBidInput): Promise<PlaceBidResult> {
    if (input.amountCents > MAX_BID_CENTS) {
      this.logger.warn(`Bid of ${input.amountCents} cents on auction ${input.auctionId} exceeds the maximum`);

      throw new InvalidValueError('bid_above_maximum');
    }

    const result = await this.db.withLockedAuction(input.auctionId, (auction, session) =>
      this.place(input, auction, session),
    );

    if (!result) {
      this.logger.warn(`Auction ${input.auctionId} not found`);

      throw new NotFoundError('auction_not_found');
    }

    return result;
  }

  private async place(
    input: PlaceBidInput,
    auction: LockedAuction,
    session: PlaceBidSession,
  ): Promise<PlaceBidResult> {
    this.assertOpen(input.auctionId, auction);

    if (input.email === auction.athleteEmail) {
      this.logger.warn(`Self-bid refused on auction ${input.auctionId}`);

      throw new ForbiddenError('self_bid_not_allowed');
    }

    const bidderId = await session.upsertBidder(input.email);
    const leading = await session.findLeading();

    if (leading && leading.bidderId === bidderId) {
      this.logger.warn(`Bidder ${bidderId} already leads auction ${input.auctionId}`);

      throw new ConflictError('already_leading');
    }

    const minimum = minimumNextBidCents(leading ? leading.amountCents : null, auction.floorPriceCents);

    if (input.amountCents < minimum) {
      this.logger.warn(
        `Bid of ${input.amountCents} cents on auction ${input.auctionId} is below the minimum of ${minimum}`,
      );

      throw new InvalidValueError('bid_below_minimum');
    }

    if (leading) {
      // The partial unique index allows one LEADING bid per auction, so demote before inserting.
      await session.markOutbid(leading.id);
    }

    const bid = await session.insertLeading(bidderId, input.amountCents);

    return {
      bid,
      previousLeader: leading ? { bidId: leading.id, bidderId: leading.bidderId, amountCents: leading.amountCents } : null,
    };
  }

  private assertOpen(auctionId: AuctionId, auction: LockedAuction): void {
    if (auction.status !== 'OPEN') {
      this.logger.warn(`Auction ${auctionId} is ${auction.status}, not open for bids`);

      throw new ConflictError('auction_not_open');
    }

    if (auction.closeAt <= auction.dbNow) {
      this.logger.warn(`Auction ${auctionId} closed at ${auction.closeAt.toISOString()}`);

      throw new ConflictError('auction_not_open');
    }

    if (auction.athleteBanned) {
      this.logger.warn(`Auction ${auctionId} refused: seller is banned`);

      throw new ConflictError('auction_not_open');
    }
  }
}
