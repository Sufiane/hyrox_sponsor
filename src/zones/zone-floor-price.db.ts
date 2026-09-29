import { Injectable } from '@nestjs/common';
import { BodyZone } from '@prisma/client';
import { cents } from '../common/index.js';
import type { AthleteId, Cents } from '../common/index.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ZoneFloorPriceDb {
  constructor(private readonly prisma: PrismaService) {}

  async findFloorPriceCents(athleteId: AthleteId, zone: BodyZone): Promise<Cents | null> {
    const row = await this.prisma.zoneFloorPrice.findUnique({
      where: { athleteId_zone: { athleteId, zone } },
    });

    if (!row) {
      return null;
    }

    return cents(row.floorPriceCents);
  }
}
