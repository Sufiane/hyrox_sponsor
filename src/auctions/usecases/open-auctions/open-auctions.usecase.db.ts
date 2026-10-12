import { Injectable } from '@nestjs/common';
import type { AthleteId, AuctionId, RaceEntryId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { PrismaService } from '../../../prisma/prisma.service';
import type { BodyZoneValue } from '../../../zones/zone-order';

export type DueToOpen = {
  auctionId: AuctionId;
  raceEntryId: RaceEntryId;
  athleteId: AthleteId;
  zone: BodyZoneValue;
};

const OPENABLE_ENTRY = { verificationStatus: 'VERIFIED', athlete: { isBanned: false } } as const;

@Injectable()
export class OpenAuctionsUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findDue(now: Date, after: AuctionId | null, limit: number): Promise<DueToOpen[]> {
    const auctions = await this.prisma.auction.findMany({
      where: {
        status: 'SCHEDULED',
        openAt: { lte: now },
        closeAt: { gt: now },
        raceEntry: OPENABLE_ENTRY,
      },
      select: { id: true, raceEntryId: true, zone: true, raceEntry: { select: { athleteId: true } } },
      orderBy: { id: 'asc' },
      take: limit,
      ...(after === null ? {} : { cursor: { id: after }, skip: 1 }),
    });

    return auctions.map((auction) => ({
      auctionId: auction.id as AuctionId,
      raceEntryId: auction.raceEntryId as RaceEntryId,
      athleteId: auction.raceEntry.athleteId as AthleteId,
      zone: auction.zone,
    }));
  }

  async markOpen(auctionId: AuctionId, floorPriceCents: Cents, now: Date): Promise<number> {
    const result = await this.prisma.auction.updateMany({
      where: {
        id: auctionId,
        status: 'SCHEDULED',
        openAt: { lte: now },
        closeAt: { gt: now },
        raceEntry: OPENABLE_ENTRY,
      },
      data: { status: 'OPEN', floorPriceCents },
    });

    return result.count;
  }
}
