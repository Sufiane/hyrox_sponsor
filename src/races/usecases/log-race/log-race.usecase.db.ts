import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AthleteId } from '../../../common/ids';
import type { IanaTimezone } from '../../../common/iana-timezone';
import { UNIQUE_VIOLATION } from '../../../common/prisma-error-codes';
import { PrismaService } from '../../../prisma/prisma.service';
import type { RaceDivisionCode } from '../../race-division';

export type RaceEntryWithRace = Prisma.RaceEntryGetPayload<{ include: { race: true } }>;

export interface AthleteStanding {
  isBanned: boolean;
}

export interface CreateEntryParams {
  athleteId: AthleteId;
  race: { name: string; nameKey: string; date: Date; timezone: IanaTimezone; location: string };
  division: RaceDivisionCode;
  raceLocalDate: Date;
}

const ENTRY_DATE_TARGET = /race_?local_?date/i;

function isEntryDateConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== UNIQUE_VIOLATION) {
    return false;
  }

  const meta = 'meta' in error ? (error.meta as { target?: unknown } | undefined) : undefined;

  return ENTRY_DATE_TARGET.test(String(meta?.target));
}

@Injectable()
export class LogRaceUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  findAthleteStanding(id: AthleteId): Promise<AthleteStanding | null> {
    return this.prisma.athlete.findUnique({
      where: { id },
      select: { isBanned: true },
    });
  }

  async createEntry(params: CreateEntryParams): Promise<RaceEntryWithRace | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const where = {
          nameKey_date_timezone: {
            nameKey: params.race.nameKey,
            date: params.race.date,
            timezone: params.race.timezone,
          },
        };
        let race = await tx.race.findUnique({ where });

        if (!race) {
          await tx.race.createMany({ data: [params.race], skipDuplicates: true });
          race = await tx.race.findUniqueOrThrow({ where });
        }

        return tx.raceEntry.create({
          data: {
            athleteId: params.athleteId,
            raceId: race.id,
            division: params.division,
            raceDate: params.race.date,
            raceLocalDate: params.raceLocalDate,
          },
          include: { race: true },
        });
      });
    } catch (error) {
      if (isEntryDateConflict(error)) {
        return null;
      }

      throw error;
    }
  }
}
