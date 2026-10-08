import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { AthleteId } from '../common/ids';
import { cents } from '../common/money';
import type { PrismaService } from '../prisma/prisma.service';
import { ZoneFloorPriceDb } from './zone-floor-price.db';

describe('ZoneFloorPriceDb', () => {
  const athleteId = 'athlete-1' as AthleteId;
  let prisma: DeepMockProxy<PrismaService>;
  let db: ZoneFloorPriceDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new ZoneFloorPriceDb(prisma);
  });

  describe('findAllByAthlete', () => {
    describe('when the athlete has rows', () => {
      const rows = [{ zone: 'LEFT_PEC', floorPriceCents: 2500 }];

      beforeEach(() => {
        prisma.zoneFloorPrice.findMany.mockResolvedValue(rows as never);
      });

      it('queries the rows of that athlete and returns them', async () => {
        const result = await db.findAllByAthlete(athleteId);

        expect(prisma.zoneFloorPrice.findMany).toHaveBeenCalledWith({ where: { athleteId } });
        expect(result).toBe(rows);
      });
    });
  });

  describe('upsert', () => {
    const saved = { zone: 'LEFT_PEC', floorPriceCents: 2500 };

    beforeEach(() => {
      prisma.zoneFloorPrice.upsert.mockResolvedValue(saved as never);
    });

    it('upserts on the athlete and zone key with the price in both branches', async () => {
      await db.upsert(athleteId, 'LEFT_PEC', cents(2500));

      expect(prisma.zoneFloorPrice.upsert).toHaveBeenCalledWith({
        where: { athleteId_zone: { athleteId, zone: 'LEFT_PEC' } },
        create: { athleteId, zone: 'LEFT_PEC', floorPriceCents: 2500 },
        update: { floorPriceCents: 2500 },
      });
    });

    it('returns the saved row', async () => {
      const result = await db.upsert(athleteId, 'LEFT_PEC', cents(2500));

      expect(result).toBe(saved);
    });
  });
});
