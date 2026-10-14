import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { raceId, type RaceId } from '../common/ids';
import { seconds, type Seconds } from '../common/seconds';
import { PrismaService } from '../prisma/prisma.service';
import type { RaceDivisionCode } from '../races/race-division';
import type { RaceCursor } from './race-cursor';

type PublicStatus = 'PENDING' | 'VERIFIED';

const ALL_PUBLIC_STATUSES: readonly PublicStatus[] = ['PENDING', 'VERIFIED'];

export type PublicRaceRecord = {
  id: RaceId;
  name: string;
  location: string;
  date: Date;
  timezone: string;
};

export type RaceCounts = { resultCount: number; verifiedCount: number };

export type PublicRaceListRecord = PublicRaceRecord & RaceCounts;

export type DivisionCountRecord = RaceCounts & { division: RaceDivisionCode };

export type PublicResultRow = { athleteName: string; finishTimeSeconds: Seconds };

export type StatusCounts = { verified: number; pending: number };

type EntryScope = {
  statuses?: readonly PublicStatus[];
  raceIds?: readonly RaceId[];
  division?: RaceDivisionCode;
  fasterThan?: Seconds;
};

// Single definition of what the public may see; every public query goes through it.
function publicEntryWhere(scope: EntryScope): Prisma.RaceEntryWhereInput {
  return {
    verificationStatus: 'VERIFIED',
    athlete: { isBanned: false },
    ...(scope.raceIds ? { raceId: { in: [...scope.raceIds] } } : {}),
    ...(scope.division ? { division: scope.division } : {}),
    raceResult: {
      is: {
        status: { in: [...(scope.statuses ?? ALL_PUBLIC_STATUSES)] },
        ...(scope.fasterThan ? { finishTimeSeconds: { lt: scope.fasterThan } } : {}),
      },
    },
  };
}

function afterCursor(cursor: RaceCursor | null): Prisma.RaceWhereInput {
  if (cursor == null) {
    return {};
  }

  return {
    OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: cursor.id } }],
  };
}

@Injectable()
export class PublicResultsDb {
  constructor(private readonly prisma: PrismaService) {}

  async listRaces(limit: number, after: RaceCursor | null): Promise<PublicRaceListRecord[]> {
    const races = await this.prisma.race.findMany({
      where: { raceEntries: { some: publicEntryWhere({}) }, ...afterCursor(after) },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, name: true, location: true, date: true, timezone: true },
    });
    const raceIds = races.map((race) => raceId(race.id));
    const [all, verified] = await Promise.all([
      this.prisma.raceEntry.groupBy({
        by: ['raceId'],
        where: publicEntryWhere({ raceIds }),
        _count: { _all: true },
      }),
      this.prisma.raceEntry.groupBy({
        by: ['raceId'],
        where: publicEntryWhere({ raceIds, statuses: ['VERIFIED'] }),
        _count: { _all: true },
      }),
    ]);
    const resultCounts = new Map(all.map((row) => [row.raceId, row._count._all]));
    const verifiedCounts = new Map(verified.map((row) => [row.raceId, row._count._all]));

    return races.map((race) => ({
      id: raceId(race.id),
      name: race.name,
      location: race.location,
      date: race.date,
      timezone: race.timezone,
      resultCount: resultCounts.get(race.id) ?? 0,
      verifiedCount: verifiedCounts.get(race.id) ?? 0,
    }));
  }

  async findRace(id: RaceId): Promise<PublicRaceRecord | null> {
    const race = await this.prisma.race.findFirst({
      where: { id, raceEntries: { some: publicEntryWhere({}) } },
      select: { id: true, name: true, location: true, date: true, timezone: true },
    });

    if (!race) {
      return null;
    }

    return {
      id: raceId(race.id),
      name: race.name,
      location: race.location,
      date: race.date,
      timezone: race.timezone,
    };
  }

  async listDivisionCounts(id: RaceId): Promise<DivisionCountRecord[]> {
    const [all, verified] = await Promise.all([
      this.prisma.raceEntry.groupBy({
        by: ['division'],
        where: publicEntryWhere({ raceIds: [id] }),
        _count: { _all: true },
      }),
      this.prisma.raceEntry.groupBy({
        by: ['division'],
        where: publicEntryWhere({ raceIds: [id], statuses: ['VERIFIED'] }),
        _count: { _all: true },
      }),
    ]);
    const verifiedCounts = new Map(verified.map((row) => [row.division, row._count._all]));

    return all.map((row) => ({
      division: row.division,
      resultCount: row._count._all,
      verifiedCount: verifiedCounts.get(row.division) ?? 0,
    }));
  }

  countVerifiedFasterThan(id: RaceId, division: RaceDivisionCode, finishTime: Seconds): Promise<number> {
    return this.prisma.raceEntry.count({
      where: publicEntryWhere({ raceIds: [id], division, statuses: ['VERIFIED'], fasterThan: finishTime }),
    });
  }

  async countByStatus(id: RaceId, division: RaceDivisionCode): Promise<StatusCounts> {
    const [verified, pending] = await Promise.all([
      this.prisma.raceEntry.count({
        where: publicEntryWhere({ raceIds: [id], division, statuses: ['VERIFIED'] }),
      }),
      this.prisma.raceEntry.count({
        where: publicEntryWhere({ raceIds: [id], division, statuses: ['PENDING'] }),
      }),
    ]);

    return { verified, pending };
  }

  listVerified(id: RaceId, division: RaceDivisionCode, offset: number, limit: number): Promise<PublicResultRow[]> {
    return this.listRows(publicEntryWhere({ raceIds: [id], division, statuses: ['VERIFIED'] }), offset, limit);
  }

  listUnverified(id: RaceId, division: RaceDivisionCode, offset: number, limit: number): Promise<PublicResultRow[]> {
    return this.listRows(publicEntryWhere({ raceIds: [id], division, statuses: ['PENDING'] }), offset, limit);
  }

  private async listRows(
    where: Prisma.RaceEntryWhereInput,
    offset: number,
    limit: number,
  ): Promise<PublicResultRow[]> {
    const entries = await this.prisma.raceEntry.findMany({
      where,
      orderBy: [{ raceResult: { finishTimeSeconds: 'asc' } }, { athlete: { name: 'asc' } }, { raceResult: { id: 'asc' } }],
      skip: offset,
      take: limit,
      select: {
        athlete: { select: { name: true } },
        raceResult: { select: { finishTimeSeconds: true } },
      },
    });

    return entries.map((entry) => ({
      athleteName: entry.athlete.name,
      finishTimeSeconds: seconds(this.requiredTime(entry.raceResult?.finishTimeSeconds)),
    }));
  }

  private requiredTime(value: number | undefined): number {
    if (value == null) {
      throw new Error('public_results_query_invariant_violated');
    }

    return value;
  }
}
