import { Injectable } from '@nestjs/common';
import { InvalidValueError } from '../../../common/domain-error';
import { ianaTimezone, type IanaTimezone } from '../../../common/iana-timezone';
import type { AthleteId, RaceEntryId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { PrismaService } from '../../../prisma/prisma.service';
import type { BodyZoneValue } from '../../../zones/zone-order';

export type MaterializeCandidate = {
  raceEntryId: RaceEntryId;
  athleteId: AthleteId;
  raceLocalDate: Date;
  timezone: IanaTimezone | null;
};

export type NewAuctionRow = {
  raceEntryId: RaceEntryId;
  zone: BodyZoneValue;
  floorPriceCents: Cents;
  openAt: Date;
  closeAt: Date;
};

@Injectable()
export class MaterializeAuctionsUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(now: Date, after: RaceEntryId | null, limit: number): Promise<MaterializeCandidate[]> {
    const entries = await this.prisma.raceEntry.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        auctions: { none: {} },
        raceDate: { gt: now },
        athlete: { isBanned: false },
      },
      select: { id: true, athleteId: true, raceLocalDate: true, race: { select: { timezone: true } } },
      orderBy: { id: 'asc' },
      take: limit,
      ...(after === null ? {} : { cursor: { id: after }, skip: 1 }),
    });

    return entries.map((entry) => ({
      raceEntryId: entry.id as RaceEntryId,
      athleteId: entry.athleteId as AthleteId,
      raceLocalDate: entry.raceLocalDate,
      timezone: this.brandTimezone(entry.race.timezone),
    }));
  }

  async createScheduled(rows: NewAuctionRow[]): Promise<number> {
    const result = await this.prisma.auction.createMany({ data: rows, skipDuplicates: true });

    return result.count;
  }

  private brandTimezone(value: string): IanaTimezone | null {
    try {
      return ianaTimezone(value);
    } catch (error) {
      if (error instanceof InvalidValueError) {
        return null;
      }

      throw error;
    }
  }
}
