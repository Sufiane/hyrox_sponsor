import { Injectable } from '@nestjs/common';
import type { AthleteId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StrikeDb {
  constructor(private readonly prisma: PrismaService) {}

  countActiveByAthlete(athleteId: AthleteId): Promise<number> {
    return this.prisma.strike.count({
      where: {
        athleteId,
        OR: [{ excludedFromCount: null }, { excludedFromCount: false }],
      },
    });
  }
}
