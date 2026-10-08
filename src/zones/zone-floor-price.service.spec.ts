import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ZoneFloorPriceService } from './zone-floor-price.service';
import { ZoneFloorPriceDb } from './zone-floor-price.db';
import { Logger } from '@nestjs/common';
import { InvalidValueError } from '../common/domain-error';
import type { AthleteId } from '../common/ids';
import { ZONE_ORDER } from './zone-order';

describe('ZoneFloorPriceService', () => {
  let db: DeepMockProxy<ZoneFloorPriceDb>;
  let service: ZoneFloorPriceService;

  beforeEach(async () => {
    db = mockDeep<ZoneFloorPriceDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [ZoneFloorPriceService, { provide: ZoneFloorPriceDb, useValue: db }],
    }).compile();
    service = moduleRef.get(ZoneFloorPriceService);
  });

  describe('getFloorPriceCents', () => {
    describe('when the athlete has set a floor for the zone', () => {
      beforeEach(() => {
        db.findFloorPriceCents.mockResolvedValue(2500 as never);
      });

      it('returns the stored floor price', async () => {
        const result = await service.getFloorPriceCents('athlete-1' as AthleteId, 'LEFT_PEC');

        expect(result).toBe(2500);
      });
    });

    describe('when the athlete has not set a floor for the zone', () => {
      beforeEach(() => {
        db.findFloorPriceCents.mockResolvedValue(null);
      });

      it('returns the platform minimum of 1000 cents', async () => {
        const result = await service.getFloorPriceCents('athlete-1' as AthleteId, 'LEFT_PEC');

        expect(result).toBe(1000);
      });
    });
  });
  describe('listForAthlete', () => {
    const athleteId = 'athlete-1' as AthleteId;

    describe('when the athlete has no rows', () => {
      beforeEach(() => {
        db.findAllByAthlete.mockResolvedValue([]);
      });

      it('returns every zone at the minimum flagged as default', async () => {
        const result = await service.listForAthlete(athleteId);

        expect(result).toEqual(ZONE_ORDER.map((zone) => ({ zone, floorPriceCents: 1000, isDefault: true })));
      });
    });

    describe('when the athlete has rows for some zones', () => {
      beforeEach(() => {
        db.findAllByAthlete.mockResolvedValue([
          { zone: 'RIGHT_PEC', floorPriceCents: 5000 },
          { zone: 'LEFT_PEC', floorPriceCents: 2500 },
        ] as never);
      });

      it('returns saved prices flagged as not default and the rest as default', async () => {
        const result = await service.listForAthlete(athleteId);

        expect(result[0]).toEqual({ zone: 'LEFT_PEC', floorPriceCents: 2500, isDefault: false });
        expect(result[1]).toEqual({ zone: 'RIGHT_PEC', floorPriceCents: 5000, isDefault: false });
        expect(result[2]).toEqual({ zone: 'UPPER_BACK', floorPriceCents: 1000, isDefault: true });
      });

      it('keeps the enum order', async () => {
        const result = await service.listForAthlete(athleteId);

        expect(result.map((entry) => entry.zone)).toEqual([...ZONE_ORDER]);
      });
    });
  });

  describe('setFloorPrice', () => {
    const athleteId = 'athlete-1' as AthleteId;

    beforeEach(() => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      db.upsert.mockImplementation(((_athlete: unknown, _zone: unknown, price: number) =>
        Promise.resolve({ floorPriceCents: price })) as never);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe.each([
      [900, 'floor_price_below_minimum'],
      [0, 'floor_price_below_minimum'],
      [999, 'floor_price_not_whole_dollars'],
      [1050, 'floor_price_not_whole_dollars'],
      [10_000_100, 'floor_price_above_maximum'],
      [1000.5, 'cents_invalid'],
      [-100, 'cents_invalid'],
    ])('when the price is %s', (price, code) => {
      it(`rejects with ${code}`, async () => {
        const result = service.setFloorPrice(athleteId, 'LEFT_PEC', price);

        await expect(result).rejects.toThrow(InvalidValueError);
        await expect(result).rejects.toThrow(code);
      });

      it('does not save', async () => {
        await service.setFloorPrice(athleteId, 'LEFT_PEC', price).catch(() => undefined);

        expect(db.upsert).not.toHaveBeenCalled();
      });

      it('logs a warning', async () => {
        await service.setFloorPrice(athleteId, 'LEFT_PEC', price).catch(() => undefined);

        expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
      });
    });

    describe.each([1000, 10_000_000])('when the price is %s', (price) => {
      it('saves it and returns the non-default view', async () => {
        const result = await service.setFloorPrice(athleteId, 'LEFT_PEC', price);

        expect(db.upsert).toHaveBeenCalledWith(athleteId, 'LEFT_PEC', price);
        expect(result).toEqual({ zone: 'LEFT_PEC', floorPriceCents: price, isDefault: false });
      });
    });
  });
});
