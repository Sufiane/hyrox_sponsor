import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../../../common/ids';
import { PrismaService } from '../../../prisma/prisma.service';

export type DueToClose = { auctionId: AuctionId; raceDate: Date };

export type CloseResult = 'already_closed' | 'no_sale' | 'won';

const CLOSABLE_STATUSES = ['SCHEDULED', 'OPEN'] as const;

@Injectable()
export class CloseAuctionsUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findDue(now: Date, after: AuctionId | null, limit: number): Promise<DueToClose[]> {
    const auctions = await this.prisma.auction.findMany({
      where: { status: { in: [...CLOSABLE_STATUSES] }, closeAt: { lte: now } },
      select: { id: true, raceEntry: { select: { raceDate: true } } },
      orderBy: { id: 'asc' },
      take: limit,
      ...(after === null ? {} : { cursor: { id: after }, skip: 1 }),
    });

    return auctions.map((auction) => ({
      auctionId: auction.id as AuctionId,
      raceDate: auction.raceEntry.raceDate,
    }));
  }

  // The status flip takes the auction row lock; the bid read must follow it so a concurrent bid either commits first or is rejected by the bidding OPEN check.
  closeAuction(auctionId: AuctionId, now: Date, proofDeadlineAt: Date): Promise<CloseResult> {
    return this.prisma.$transaction(async (tx): Promise<CloseResult> => {
      const flipped = await tx.auction.updateMany({
        where: { id: auctionId, status: { in: [...CLOSABLE_STATUSES] }, closeAt: { lte: now } },
        data: { status: 'CLOSED' },
      });

      if (flipped.count === 0) {
        return 'already_closed';
      }

      const leading = await tx.bid.findFirst({ where: { auctionId, status: 'LEADING' } });

      if (!leading) {
        await tx.auction.update({ where: { id: auctionId }, data: { outcome: 'NO_SALE' } });

        return 'no_sale';
      }

      await tx.bid.update({ where: { id: leading.id }, data: { status: 'WON' } });
      await tx.bid.updateMany({
        where: { auctionId, id: { not: leading.id }, status: 'OUTBID' },
        data: { status: 'LOST' },
      });
      await tx.auction.update({
        where: { id: auctionId },
        data: { outcome: 'AWAITING_PROOF', proofDeadlineAt },
      });

      return 'won';
    });
  }
}
