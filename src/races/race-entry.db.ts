import { Injectable } from '@nestjs/common';
import type { AthleteId, RaceId } from '../common/index.js';
import { RaceEntry } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RaceEntryDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAthleteAndRace(athleteId: AthleteId, raceId: RaceId): Promise<RaceEntry | null> {
    return this.prisma.raceEntry.findFirst({ where: { athleteId, raceId } });
  }
}
