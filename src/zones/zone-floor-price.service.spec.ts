import { ZoneFloorPriceService } from './zone-floor-price.service.js';
import { ZoneFloorPriceDb } from './zone-floor-price.db.js';

describe('ZoneFloorPriceService', () => {
  describe('getFloorPriceCents', () => {
    describe('when the athlete has set a floor for the zone', () => {
      it('returns the stored floor price', async () => {
        const db = {
          findByAthleteAndZone: vi.fn().mockResolvedValue({ floorPriceCents: 2500 }),
        } as unknown as ZoneFloorPriceDb;
        const service = new ZoneFloorPriceService(db);

        const result = await service.getFloorPriceCents('athlete-1', 'LEFT_PEC');

        expect(result).toBe(2500);
      });
    });

    describe('when the athlete has not set a floor for the zone', () => {
      it('returns the platform minimum of 1000 cents', async () => {
        const db = {
          findByAthleteAndZone: vi.fn().mockResolvedValue(null),
        } as unknown as ZoneFloorPriceDb;
        const service = new ZoneFloorPriceService(db);

        const result = await service.getFloorPriceCents('athlete-1', 'LEFT_PEC');

        expect(result).toBe(1000);
      });
    });
  });
});
