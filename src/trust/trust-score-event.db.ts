import { Injectable } from '@nestjs/common';
import type { AthleteId } from '../common/ids.js';
import { TrustScoreEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TrustScoreEventDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAthlete(athleteId: AthleteId): Promise<TrustScoreEvent[]> {
    return this.prisma.trustScoreEvent.findMany({
      where: { athleteId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
