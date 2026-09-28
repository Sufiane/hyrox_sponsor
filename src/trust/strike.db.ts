import { Injectable } from '@nestjs/common';
import { Strike } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class StrikeDb {
  constructor(private readonly prisma: PrismaService) {}

  findActiveByAthlete(athleteId: string): Promise<Strike[]> {
    return this.prisma.strike.findMany({
      where: {
        athleteId,
        OR: [{ excludedFromCount: null }, { excludedFromCount: false }],
      },
    });
  }
}
