import { Injectable } from '@nestjs/common';
import { ZoneFloorPriceDb } from './zone-floor-price.db.js';

type BodyZoneValue = Parameters<ZoneFloorPriceDb['findByAthleteAndZone']>[1];

const PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = 1000;

@Injectable()
export class ZoneFloorPriceService {
  constructor(private readonly db: ZoneFloorPriceDb) {}

  async getFloorPriceCents(athleteId: string, zone: BodyZoneValue): Promise<number> {
    const floorPrice = await this.db.findByAthleteAndZone(athleteId, zone);

    if (!floorPrice) {
      return PLATFORM_MINIMUM_FLOOR_PRICE_CENTS;
    }

    return floorPrice.floorPriceCents;
  }
}
