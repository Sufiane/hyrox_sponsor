import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { RaceEntryId } from '../../../common/ids';
import { cents } from '../../../common/money';
import type { PrismaService } from '../../../prisma/prisma.service';
import { MaterializeAuctionsUsecaseDb } from './materialize-auctions.usecase.db';

describe('MaterializeAuctionsUsecaseDb', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  let prisma: DeepMockProxy<PrismaService>;
  let db: MaterializeAuctionsUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new MaterializeAuctionsUsecaseDb(prisma);
  });

  describe('findCandidates', () => {
    beforeEach(() => {
      prisma.raceEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1',
          athleteId: 'athlete-1',
          raceLocalDate: new Date('2026-11-14T00:00:00Z'),
          race: { timezone: 'America/Chicago' },
        },
      ] as never);
    });

    it('filters to verified, unbanned, future entries without auctions', async () => {
      await db.findCandidates(now, null, 100);

      expect(prisma.raceEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            verificationStatus: 'VERIFIED',
            auctions: { none: {} },
            raceDate: { gt: now },
            athlete: { isBanned: false },
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      );
    });

    it('starts after the cursor when given one', async () => {
      await db.findCandidates(now, 'entry-0' as RaceEntryId, 100);

      expect(prisma.raceEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'entry-0' }, skip: 1 }),
      );
    });

    it('returns branded candidates', async () => {
      const result = await db.findCandidates(now, null, 100);

      expect(result).toEqual([
        {
          raceEntryId: 'entry-1',
          athleteId: 'athlete-1',
          raceLocalDate: new Date('2026-11-14T00:00:00Z'),
          timezone: 'America/Chicago',
        },
      ]);
    });
  });

  describe('when a race has an invalid timezone', () => {
    beforeEach(() => {
      prisma.raceEntry.findMany.mockResolvedValue([
        { id: 'entry-1', athleteId: 'athlete-1', raceLocalDate: new Date(), race: { timezone: 'Not/AZone' } },
        { id: 'entry-2', athleteId: 'athlete-2', raceLocalDate: new Date(), race: { timezone: 'America/Chicago' } },
      ] as never);
    });

    it('returns a null timezone for that row without throwing', async () => {
      const result = await db.findCandidates(now, null, 100);

      expect(result.map((candidate) => candidate.timezone)).toEqual([null, 'America/Chicago']);
    });
  });

  describe('createScheduled', () => {
    it('inserts with skipDuplicates and returns the created count', async () => {
      prisma.auction.createMany.mockResolvedValue({ count: 9 });
      const openAt = new Date('2026-11-02T06:00:00Z');
      const closeAt = new Date('2026-11-09T06:00:00Z');

      const result = await db.createScheduled([
        { raceEntryId: 'entry-1' as RaceEntryId, zone: 'LEFT_PEC', floorPriceCents: cents(1000), openAt, closeAt },
      ]);

      expect(prisma.auction.createMany).toHaveBeenCalledWith({
        data: [{ raceEntryId: 'entry-1', zone: 'LEFT_PEC', floorPriceCents: 1000, openAt, closeAt }],
        skipDuplicates: true,
      });
      expect(result).toBe(9);
    });
  });
});
