import { Injectable } from '@nestjs/common';
import { BodyZone, ZoneFloorPrice } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ZoneFloorPriceDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAthleteAndZone(athleteId: string, zone: BodyZone): Promise<ZoneFloorPrice | null> {
    return this.prisma.zoneFloorPrice.findUnique({
      where: { athleteId_zone: { athleteId, zone } },
    });
  }
}
