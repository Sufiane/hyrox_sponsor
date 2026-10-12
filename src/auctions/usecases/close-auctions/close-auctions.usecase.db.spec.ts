import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { AuctionId } from '../../../common/ids';
import type { PrismaService } from '../../../prisma/prisma.service';
import { CloseAuctionsUsecaseDb } from './close-auctions.usecase.db';

describe('CloseAuctionsUsecaseDb', () => {
  const now = new Date('2026-11-09T06:00:00Z');
  const auctionId = 'auction-1' as AuctionId;
  const proofDeadlineAt = new Date('2026-11-16T15:00:00Z');
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<PrismaService>;
  let db: CloseAuctionsUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(((callback: (client: unknown) => unknown) => callback(tx)) as never);
    db = new CloseAuctionsUsecaseDb(prisma);
  });

  describe('findDue', () => {
    beforeEach(() => {
      prisma.auction.findMany.mockResolvedValue([
        { id: 'auction-1', raceEntry: { raceDate: new Date('2026-11-14T15:00:00Z') } },
      ] as never);
    });

    it('selects scheduled and open auctions past their close', async () => {
      await db.findDue(now, null, 100);

      expect(prisma.auction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['SCHEDULED', 'OPEN'] }, closeAt: { lte: now } },
          select: { id: true, raceEntry: { select: { raceDate: true } } },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      );
    });

    it('starts after the cursor when given one', async () => {
      await db.findDue(now, 'auction-0' as AuctionId, 100);

      expect(prisma.auction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'auction-0' }, skip: 1 }),
      );
    });

    it('returns the auction id and race date', async () => {
      const result = await db.findDue(now, null, 100);

      expect(result).toEqual([{ auctionId: 'auction-1', raceDate: new Date('2026-11-14T15:00:00Z') }]);
    });
  });

  describe('closeAuction', () => {
    describe('when the compare-and-set matches no row', () => {
      beforeEach(() => {
        tx.auction.updateMany.mockResolvedValue({ count: 0 });
      });

      it('returns already_closed', async () => {
        const result = await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(result).toBe('already_closed');
      });

      it('flips status only under the closable predicate', async () => {
        await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(tx.auction.updateMany).toHaveBeenCalledWith({
          where: { id: auctionId, status: { in: ['SCHEDULED', 'OPEN'] }, closeAt: { lte: now } },
          data: { status: 'CLOSED' },
        });
      });

      it('reads and writes no bids', async () => {
        await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(tx.bid.findFirst).not.toHaveBeenCalled();
        expect(tx.bid.update).not.toHaveBeenCalled();
      });
    });

    describe('when closed and there is no leading bid', () => {
      beforeEach(() => {
        tx.auction.updateMany.mockResolvedValue({ count: 1 });
        tx.bid.findFirst.mockResolvedValue(null);
      });

      it('returns no_sale', async () => {
        const result = await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(result).toBe('no_sale');
      });

      it('sets the NO_SALE outcome once', async () => {
        await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(tx.auction.update).toHaveBeenCalledOnce();
        expect(tx.auction.update).toHaveBeenCalledWith({ where: { id: auctionId }, data: { outcome: 'NO_SALE' } });
      });

      it('writes no bids', async () => {
        await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(tx.bid.update).not.toHaveBeenCalled();
        expect(tx.bid.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('when closed with a leading bid', () => {
      beforeEach(() => {
        tx.auction.updateMany.mockResolvedValue({ count: 1 });
        tx.bid.findFirst.mockResolvedValue({ id: 'bid-1' } as never);
      });

      it('returns won', async () => {
        const result = await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(result).toBe('won');
      });

      it('looks up the leading bid of the auction', async () => {
        await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(tx.bid.findFirst).toHaveBeenCalledWith({ where: { auctionId, status: 'LEADING' } });
      });

      it('marks the leading bid won', async () => {
        await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(tx.bid.update).toHaveBeenCalledWith({ where: { id: 'bid-1' }, data: { status: 'WON' } });
      });

      it('marks the outbid bids lost', async () => {
        await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(tx.bid.updateMany).toHaveBeenCalledWith({
          where: { auctionId, id: { not: 'bid-1' }, status: 'OUTBID' },
          data: { status: 'LOST' },
        });
      });

      it('awaits proof with the deadline', async () => {
        await db.closeAuction(auctionId, now, proofDeadlineAt);

        expect(tx.auction.update).toHaveBeenCalledWith({
          where: { id: auctionId },
          data: { outcome: 'AWAITING_PROOF', proofDeadlineAt },
        });
      });
    });
  });
});
