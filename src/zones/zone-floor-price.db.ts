import { Injectable } from '@nestjs/common';
import { BodyZone } from '@prisma/client';
import { cents } from '../common/money';
import type { AthleteId } from '../common/ids';
import type { Cents } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

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
