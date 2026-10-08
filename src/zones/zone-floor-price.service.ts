import { Injectable, Logger } from '@nestjs/common';
import { InvalidValueError } from '../common/domain-error';
import { cents } from '../common/money';
import type { AthleteId } from '../common/ids';
import type { Cents } from '../common/money';
import {
  FLOOR_PRICE_STEP_CENTS,
  MAXIMUM_FLOOR_PRICE_CENTS,
  PLATFORM_MINIMUM_FLOOR_PRICE_CENTS,
} from './floor-price-limits';
import { ZoneFloorPriceDb } from './zone-floor-price.db';
import { ZONE_ORDER, type BodyZoneValue } from './zone-order';

export type ZoneFloorPriceView = {
  zone: BodyZoneValue;
  floorPriceCents: Cents;
  isDefault: boolean;
};

@Injectable()
export class ZoneFloorPriceService {
  private readonly logger = new Logger(ZoneFloorPriceService.name);

  constructor(private readonly db: ZoneFloorPriceDb) {}

  async getFloorPriceCents(athleteId: AthleteId, zone: BodyZoneValue): Promise<Cents> {
    const floorPrice = await this.db.findFloorPriceCents(athleteId, zone);

    if (floorPrice === null) {
      return PLATFORM_MINIMUM_FLOOR_PRICE_CENTS;
    }

    return floorPrice;
  }

  async listForAthlete(athleteId: AthleteId): Promise<ZoneFloorPriceView[]> {
    const rows = await this.db.findAllByAthlete(athleteId);
    const savedByZone = new Map<BodyZoneValue, number>();

    for (const row of rows) {
      savedByZone.set(row.zone, row.floorPriceCents);
    }

    return ZONE_ORDER.map((zone) => this.toView(zone, savedByZone.get(zone)));
  }

  async setFloorPrice(
    athleteId: AthleteId,
    zone: BodyZoneValue,
    floorPriceCents: number,
  ): Promise<ZoneFloorPriceView> {
    const validCents = this.validate(athleteId, zone, floorPriceCents);
    const saved = await this.db.upsert(athleteId, zone, validCents);

    return { zone, floorPriceCents: cents(saved.floorPriceCents), isDefault: false };
  }

  private toView(zone: BodyZoneValue, saved: number | undefined): ZoneFloorPriceView {
    if (saved === undefined) {
      return { zone, floorPriceCents: PLATFORM_MINIMUM_FLOOR_PRICE_CENTS, isDefault: true };
    }

    return { zone, floorPriceCents: cents(saved), isDefault: false };
  }

  private validate(athleteId: AthleteId, zone: BodyZoneValue, floorPriceCents: number): Cents {
    const validCents = this.toCents(athleteId, zone, floorPriceCents);

    if (validCents % FLOOR_PRICE_STEP_CENTS !== 0) {
      this.reject(athleteId, zone, floorPriceCents, 'floor_price_not_whole_dollars');
    }

    if (validCents < PLATFORM_MINIMUM_FLOOR_PRICE_CENTS) {
      this.reject(athleteId, zone, floorPriceCents, 'floor_price_below_minimum');
    }

    if (validCents > MAXIMUM_FLOOR_PRICE_CENTS) {
      this.reject(athleteId, zone, floorPriceCents, 'floor_price_above_maximum');
    }

    return validCents;
  }

  private toCents(athleteId: AthleteId, zone: BodyZoneValue, floorPriceCents: number): Cents {
    try {
      return cents(floorPriceCents);
    } catch (error) {
      this.logger.warn(`Athlete ${athleteId} sent invalid cents ${floorPriceCents} for zone ${zone}`);

      throw error;
    }
  }

  private reject(athleteId: AthleteId, zone: BodyZoneValue, floorPriceCents: number, code: string): never {
    this.logger.warn(`Athlete ${athleteId} rejected floor price ${floorPriceCents} for zone ${zone}: ${code}`);

    throw new InvalidValueError(code);
  }
}
