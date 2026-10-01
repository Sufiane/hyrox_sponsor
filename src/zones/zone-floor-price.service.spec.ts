import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ZoneFloorPriceService } from './zone-floor-price.service.js';
import { ZoneFloorPriceDb } from './zone-floor-price.db.js';
import type { AthleteId } from '../common/ids.js';

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
});
