import { Injectable } from '@nestjs/common';
import { RaceEntry } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RaceEntryDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAthleteAndRace(athleteId: string, raceId: string): Promise<RaceEntry | null> {
    return this.prisma.raceEntry.findFirst({ where: { athleteId, raceId } });
  }
}
