import { Injectable } from '@nestjs/common';
import { cents } from '../common/index.js';
import type { AthleteId, Cents } from '../common/index.js';
import { ZoneFloorPriceDb } from './zone-floor-price.db.js';

type BodyZoneValue = Parameters<ZoneFloorPriceDb['findFloorPriceCents']>[1];

const PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = cents(1000);

@Injectable()
export class ZoneFloorPriceService {
  constructor(private readonly db: ZoneFloorPriceDb) {}

  async getFloorPriceCents(athleteId: AthleteId, zone: BodyZoneValue): Promise<Cents> {
    const floorPrice = await this.db.findFloorPriceCents(athleteId, zone);

    if (floorPrice === null) {
      return PLATFORM_MINIMUM_FLOOR_PRICE_CENTS;
    }

    return floorPrice;
  }
}
