import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeEmail, type NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import { cents, type Cents } from '../../../common/money';
import {
  stripeCustomerId,
  stripePaymentIntentId,
  stripePaymentMethodId,
  type StripeCustomerId,
  type StripePaymentIntentId,
  type StripePaymentMethodId,
} from '../../../common/stripe-ids';
import { PrismaService } from '../../../prisma/prisma.service';

const TRANSACTION_TIMEOUT_MS = 10_000;

const AUCTION_SELECT = {
  status: true,
  closeAt: true,
  floorPriceCents: true,
  raceEntry: { select: { athlete: { select: { email: true, isBanned: true } } } },
} as const;

type AuctionRow = Prisma.AuctionGetPayload<{ select: typeof AUCTION_SELECT }>;

export type LockedAuction = {
  status: 'SCHEDULED' | 'OPEN' | 'CLOSED';
  closeAt: Date;
  dbNow: Date;
  floorPriceCents: Cents;
  athleteEmail: NormalizedEmail;
  athleteBanned: boolean;
};

export type BiddingBidder = {
  id: BidderId;
  email: NormalizedEmail;
  tokenVersion: number;
  stripeCustomerId: StripeCustomerId | null;
  defaultPaymentMethodId: StripePaymentMethodId | null;
};

export type ActiveHold = { paymentIntentId: StripePaymentIntentId; amountCents: Cents };

export type AuthorizedHold = ActiveHold & { captureBefore: Date | null };

export type BidLeader = { bidderId: BidderId; amountCents: Cents };

export type LeadingBid = BidLeader & { id: BidId; hold: ActiveHold | null };

export type BiddingSnapshot = { auction: LockedAuction; leading: BidLeader | null };

export type PlacedBid = {
  id: BidId;
  auctionId: AuctionId;
  bidderId: BidderId;
  amountCents: Cents;
  placedAt: Date;
};

export interface PlaceBidSession {
  findLeading(): Promise<LeadingBid | null>;
  markOutbid(bidId: BidId): Promise<void>;
  insertLeading(bidderId: BidderId, amountCents: Cents): Promise<PlacedBid>;
  recordAuthorized(bidId: BidId, hold: AuthorizedHold): Promise<void>;
}

@Injectable()
export class PlaceBidUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findBidder(id: BidderId): Promise<BiddingBidder | null> {
    const bidder = await this.prisma.bidder.findUnique({
      where: { id },
      select: { id: true, email: true, tokenVersion: true, stripeCustomerId: true, defaultPaymentMethodId: true },
    });

    if (!bidder) {
      return null;
    }

    return {
      id,
      email: normalizeEmail(bidder.email),
      tokenVersion: bidder.tokenVersion,
      stripeCustomerId: bidder.stripeCustomerId == null ? null : stripeCustomerId(bidder.stripeCustomerId),
      defaultPaymentMethodId:
        bidder.defaultPaymentMethodId == null ? null : stripePaymentMethodId(bidder.defaultPaymentMethodId),
    };
  }

  async readBiddingSnapshot(auctionId: AuctionId): Promise<BiddingSnapshot | null> {
    const [{ db_now: dbNow }] = await this.prisma.$queryRaw<Array<{ db_now: Date }>>`SELECT now() AS "db_now"`;
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: {
        ...AUCTION_SELECT,
        bids: { where: { status: 'LEADING' }, select: { bidderId: true, amountCents: true }, take: 1 },
      },
    });

    if (!auction) {
      return null;
    }

    const [leading] = auction.bids;

    return {
      auction: this.toLockedAuction(auction, dbNow),
      leading:
        leading === undefined
          ? null
          : { bidderId: leading.bidderId as BidderId, amountCents: cents(leading.amountCents) },
    };
  }

  async bidExists(bidId: BidId): Promise<boolean> {
    const bid = await this.prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });

    return bid !== null;
  }

  withLockedAuction<T>(
    auctionId: AuctionId,
    work: (auction: LockedAuction, session: PlaceBidSession) => Promise<T>,
  ): Promise<T | null> {
    return this.prisma.$transaction(
      async (tx): Promise<T | null> => {
        // Must be the first statement: later reads then see everything committed before the lock was granted.
        const locked = await tx.$queryRaw<Array<{ id: string; db_now: Date }>>`
          SELECT "id", now() AS "db_now" FROM "auctions" WHERE "id" = ${auctionId} FOR UPDATE
        `;

        if (locked.length === 0) {
          return null;
        }

        const auction = await tx.auction.findUniqueOrThrow({ where: { id: auctionId }, select: AUCTION_SELECT });

        return work(this.toLockedAuction(auction, locked[0].db_now), this.sessionFor(tx, auctionId));
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  private toLockedAuction(auction: AuctionRow, dbNow: Date): LockedAuction {
    return {
      status: auction.status,
      closeAt: auction.closeAt,
      dbNow,
      floorPriceCents: cents(auction.floorPriceCents),
      athleteEmail: normalizeEmail(auction.raceEntry.athlete.email),
      athleteBanned: auction.raceEntry.athlete.isBanned,
    };
  }

  private sessionFor(tx: Prisma.TransactionClient, auctionId: AuctionId): PlaceBidSession {
    return {
      findLeading: async (): Promise<LeadingBid | null> => {
        const leading = await tx.bid.findFirst({
          where: { auctionId, status: 'LEADING' },
          select: {
            id: true,
            bidderId: true,
            amountCents: true,
            escrowTransactions: {
              select: { type: true, stripePaymentIntentId: true, amountCents: true },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
            },
          },
        });

        if (!leading) {
          return null;
        }

        const [latest] = leading.escrowTransactions;

        return {
          id: leading.id as BidId,
          bidderId: leading.bidderId as BidderId,
          amountCents: cents(leading.amountCents),
          hold:
            latest?.type === 'AUTHORIZED'
              ? {
                  paymentIntentId: stripePaymentIntentId(latest.stripePaymentIntentId),
                  amountCents: cents(latest.amountCents),
                }
              : null,
        };
      },
      markOutbid: async (bidId): Promise<void> => {
        await tx.bid.update({ where: { id: bidId }, data: { status: 'OUTBID' } });
      },
      insertLeading: async (bidderId, amountCents): Promise<PlacedBid> => {
        const bid = await tx.bid.create({ data: { auctionId, bidderId, amountCents, status: 'LEADING' } });

        await tx.auction.update({ where: { id: auctionId }, data: { currentLeadingBidId: bid.id } });

        return {
          id: bid.id as BidId,
          auctionId,
          bidderId,
          amountCents,
          placedAt: bid.placedAt,
        };
      },
      recordAuthorized: async (bidId, hold): Promise<void> => {
        await tx.escrowTransaction.create({
          data: {
            bidId,
            stripePaymentIntentId: hold.paymentIntentId,
            type: 'AUTHORIZED',
            amountCents: hold.amountCents,
            captureBefore: hold.captureBefore,
          },
        });
      },
    };
  }
}
