import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeEmail, type NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import { cents, type Cents } from '../../../common/money';
import { PrismaService } from '../../../prisma/prisma.service';

const TRANSACTION_TIMEOUT_MS = 10_000;

export type LockedAuction = {
  status: 'SCHEDULED' | 'OPEN' | 'CLOSED';
  closeAt: Date;
  dbNow: Date;
  floorPriceCents: Cents;
  athleteEmail: NormalizedEmail;
  athleteBanned: boolean;
};

export type LeadingBid = { id: BidId; bidderId: BidderId; amountCents: Cents };

export type PlacedBid = {
  id: BidId;
  auctionId: AuctionId;
  bidderId: BidderId;
  amountCents: Cents;
  placedAt: Date;
};

export interface PlaceBidSession {
  upsertBidder(email: NormalizedEmail): Promise<BidderId>;
  findLeading(): Promise<LeadingBid | null>;
  markOutbid(bidId: BidId): Promise<void>;
  insertLeading(bidderId: BidderId, amountCents: Cents): Promise<PlacedBid>;
}

@Injectable()
export class PlaceBidUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

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

        const auction = await tx.auction.findUniqueOrThrow({
          where: { id: auctionId },
          select: {
            status: true,
            closeAt: true,
            floorPriceCents: true,
            raceEntry: { select: { athlete: { select: { email: true, isBanned: true } } } },
          },
        });

        return work(
          {
            status: auction.status,
            closeAt: auction.closeAt,
            dbNow: locked[0].db_now,
            floorPriceCents: cents(auction.floorPriceCents),
            athleteEmail: normalizeEmail(auction.raceEntry.athlete.email),
            athleteBanned: auction.raceEntry.athlete.isBanned,
          },
          this.sessionFor(tx, auctionId),
        );
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  private sessionFor(tx: Prisma.TransactionClient, auctionId: AuctionId): PlaceBidSession {
    return {
      upsertBidder: async (email): Promise<BidderId> => {
        const bidder = await tx.bidder.upsert({ where: { email }, create: { email }, update: {} });

        return bidder.id as BidderId;
      },
      findLeading: async (): Promise<LeadingBid | null> => {
        const leading = await tx.bid.findFirst({ where: { auctionId, status: 'LEADING' } });

        if (!leading) {
          return null;
        }

        return {
          id: leading.id as BidId,
          bidderId: leading.bidderId as BidderId,
          amountCents: cents(leading.amountCents),
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
    };
  }
}
