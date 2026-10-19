import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import { cents } from '../../../common/money';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PlaceBidUsecaseDb, type PlaceBidSession } from './place-bid.usecase.db';

describe('PlaceBidUsecaseDb', () => {
  const auctionId = 'auction-1' as AuctionId;
  const closeAt = new Date('2026-11-09T06:00:00Z');
  const dbNow = new Date('2026-11-08T12:00:00Z');
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<PrismaService>;
  let db: PlaceBidUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(((callback: (client: unknown) => unknown) => callback(tx)) as never);
    db = new PlaceBidUsecaseDb(prisma);
  });

  describe('withLockedAuction', () => {
    describe('when the auction does not exist', () => {
      beforeEach(() => {
        tx.$queryRaw.mockResolvedValue([] as never);
      });

      it('returns null without running the work', async () => {
        const work = vi.fn();

        const result = await db.withLockedAuction(auctionId, work);

        expect(result).toBeNull();
        expect(work).not.toHaveBeenCalled();
        expect(tx.auction.findUniqueOrThrow).not.toHaveBeenCalled();
      });
    });

    describe('when the auction exists', () => {
      beforeEach(() => {
        tx.$queryRaw.mockResolvedValueOnce([{ id: 'auction-1', db_now: dbNow }] as never);
        tx.auction.findUniqueOrThrow.mockResolvedValue({
          status: 'OPEN',
          closeAt,
          floorPriceCents: 1000,
          raceEntry: { athlete: { email: 'athlete@example.com', isBanned: false } },
        } as never);
      });

      it('locks the row with FOR UPDATE before reading it', async () => {
        await db.withLockedAuction(auctionId, async () => 'done');

        const [strings] = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];

        expect(strings.join('?')).toContain('FOR UPDATE');
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          tx.auction.findUniqueOrThrow.mock.invocationCallOrder[0],
        );
      });

      it('reads the database time in the lock statement', async () => {
        await db.withLockedAuction(auctionId, async () => 'done');

        const [strings] = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];

        expect(strings.join('?')).toContain('now() AS "db_now"');
        expect(tx.$queryRaw.mock.calls).toHaveLength(1);
      });

      it('runs the work in a transaction with a timeout', async () => {
        await db.withLockedAuction(auctionId, async () => 'done');

        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 10_000 });
      });

      it('passes the branded snapshot and returns the work result', async () => {
        const work = vi.fn().mockResolvedValue('done');

        const result = await db.withLockedAuction(auctionId, work);

        expect(result).toBe('done');
        expect(work).toHaveBeenCalledWith(
          {
            status: 'OPEN',
            closeAt,
            dbNow,
            floorPriceCents: 1000,
            athleteEmail: 'athlete@example.com',
            athleteBanned: false,
          },
          expect.any(Object),
        );
      });
    });
  });

  describe('session', () => {
    let session: PlaceBidSession;

    beforeEach(async () => {
      tx.$queryRaw.mockResolvedValueOnce([{ id: 'auction-1', db_now: dbNow }] as never);
      tx.auction.findUniqueOrThrow.mockResolvedValue({
        status: 'OPEN',
        closeAt,
        floorPriceCents: 1000,
        raceEntry: { athlete: { email: 'athlete@example.com', isBanned: false } },
      } as never);
      await db.withLockedAuction(auctionId, async (_auction, boundSession) => {
        session = boundSession;
      });
    });

    describe('upsertBidder', () => {
      it('upserts by email and returns the bidder id', async () => {
        tx.bidder.upsert.mockResolvedValue({ id: 'bidder-1' } as never);

        const result = await session.upsertBidder('brand@example.com' as NormalizedEmail);

        expect(result).toBe('bidder-1');
        expect(tx.bidder.upsert).toHaveBeenCalledWith({
          where: { email: 'brand@example.com' },
          create: { email: 'brand@example.com' },
          update: {},
        });
      });
    });

    describe('findLeading', () => {
      describe('when there is a leading bid', () => {
        it('returns it with a validated amount', async () => {
          tx.bid.findFirst.mockResolvedValue({ id: 'bid-1', bidderId: 'bidder-1', amountCents: 5000 } as never);

          const result = await session.findLeading();

          expect(result).toEqual({ id: 'bid-1', bidderId: 'bidder-1', amountCents: 5000 });
          expect(tx.bid.findFirst).toHaveBeenCalledWith({ where: { auctionId, status: 'LEADING' } });
        });
      });

      describe('when there is no leading bid', () => {
        it('returns null', async () => {
          tx.bid.findFirst.mockResolvedValue(null);

          expect(await session.findLeading()).toBeNull();
        });
      });
    });

    describe('markOutbid', () => {
      it('sets the bid status to OUTBID', async () => {
        await session.markOutbid('bid-1' as BidId);

        expect(tx.bid.update).toHaveBeenCalledWith({ where: { id: 'bid-1' }, data: { status: 'OUTBID' } });
      });
    });

    describe('insertLeading', () => {
      const placedAt = new Date('2026-11-08T10:00:00Z');

      beforeEach(() => {
        tx.bid.create.mockResolvedValue({
          id: 'bid-2',
          auctionId: 'auction-1',
          bidderId: 'bidder-2',
          amountCents: 5500,
          placedAt,
        } as never);
      });

      it('creates a LEADING bid and points the auction at it', async () => {
        const result = await session.insertLeading('bidder-2' as BidderId, cents(5500));

        expect(tx.bid.create).toHaveBeenCalledWith({
          data: { auctionId, bidderId: 'bidder-2', amountCents: 5500, status: 'LEADING' },
        });
        expect(tx.auction.update).toHaveBeenCalledWith({
          where: { id: auctionId },
          data: { currentLeadingBidId: 'bid-2' },
        });
        expect(result).toEqual({
          id: 'bid-2',
          auctionId: 'auction-1',
          bidderId: 'bidder-2',
          amountCents: 5500,
          placedAt,
        });
      });
    });
  });
});
