import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class StrikeDb {
  constructor(private readonly prisma: PrismaService) {}

  countActiveByAthlete(athleteId: string): Promise<number> {
    return this.prisma.strike.count({
      where: {
        athleteId,
        OR: [{ excludedFromCount: null }, { excludedFromCount: false }],
      },
    });
  }
}
