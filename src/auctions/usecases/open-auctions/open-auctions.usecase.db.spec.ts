import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { AuctionId } from '../../../common/ids';
import { cents } from '../../../common/money';
import type { PrismaService } from '../../../prisma/prisma.service';
import { OpenAuctionsUsecaseDb } from './open-auctions.usecase.db';

describe('OpenAuctionsUsecaseDb', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const openableEntry = { verificationStatus: 'VERIFIED', athlete: { isBanned: false } };
  let prisma: DeepMockProxy<PrismaService>;
  let db: OpenAuctionsUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new OpenAuctionsUsecaseDb(prisma);
  });

  describe('findDue', () => {
    beforeEach(() => {
      prisma.auction.findMany.mockResolvedValue([
        { id: 'auction-1', raceEntryId: 'entry-1', zone: 'LEFT_PEC', raceEntry: { athleteId: 'athlete-1' } },
      ] as never);
    });

    it('filters to scheduled, due, verified, unbanned auctions', async () => {
      await db.findDue(now, null, 100);

      expect(prisma.auction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'SCHEDULED',
            openAt: { lte: now },
            closeAt: { gt: now },
            raceEntry: openableEntry,
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      );
    });

    it('omits the cursor on the first page', async () => {
      await db.findDue(now, null, 100);

      expect(prisma.auction.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ cursor: expect.anything() }),
      );
    });

    it('starts after the cursor when given one', async () => {
      await db.findDue(now, 'auction-0' as AuctionId, 100);

      expect(prisma.auction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'auction-0' }, skip: 1 }),
      );
    });

    it('flattens the athlete id onto the result', async () => {
      const result = await db.findDue(now, null, 100);

      expect(result).toEqual([
        { auctionId: 'auction-1', raceEntryId: 'entry-1', athleteId: 'athlete-1', zone: 'LEFT_PEC' },
      ]);
    });
  });

  describe('markOpen', () => {
    beforeEach(() => {
      prisma.auction.updateMany.mockResolvedValue({ count: 1 });
    });

    it('compare-and-sets the open transition with the floor snapshot', async () => {
      await db.markOpen('auction-1' as AuctionId, cents(2500), now);

      expect(prisma.auction.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'auction-1',
          status: 'SCHEDULED',
          openAt: { lte: now },
          closeAt: { gt: now },
          raceEntry: openableEntry,
        },
        data: { status: 'OPEN', floorPriceCents: 2500 },
      });
    });

    it('returns the updated row count', async () => {
      const result = await db.markOpen('auction-1' as AuctionId, cents(2500), now);

      expect(result).toBe(1);
    });
  });
});
