import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { stripePaymentIntentId } from '../../../common/stripe-ids';
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

  describe('findBidder', () => {
    describe('when the bidder exists with a card', () => {
      beforeEach(() => {
        prisma.bidder.findUnique.mockResolvedValue({
          id: 'bidder-1',
          email: 'brand@example.com',
          tokenVersion: 2,
          stripeCustomerId: 'cus_1',
          defaultPaymentMethodId: 'pm_1',
        } as never);
      });

      it('returns the branded bidder', async () => {
        await expect(db.findBidder('bidder-1' as BidderId)).resolves.toEqual({
          id: 'bidder-1',
          email: 'brand@example.com',
          tokenVersion: 2,
          stripeCustomerId: 'cus_1',
          defaultPaymentMethodId: 'pm_1',
        });
        expect(prisma.bidder.findUnique).toHaveBeenCalledWith({
          where: { id: 'bidder-1' },
          select: { id: true, email: true, tokenVersion: true, stripeCustomerId: true, defaultPaymentMethodId: true },
        });
      });
    });

    describe('when the bidder has no card', () => {
      beforeEach(() => {
        prisma.bidder.findUnique.mockResolvedValue({
          id: 'bidder-1',
          email: 'brand@example.com',
          tokenVersion: 0,
          stripeCustomerId: null,
          defaultPaymentMethodId: null,
        } as never);
      });

      it('returns null card fields', async () => {
        await expect(db.findBidder('bidder-1' as BidderId)).resolves.toMatchObject({
          stripeCustomerId: null,
          defaultPaymentMethodId: null,
        });
      });
    });

    describe('when the bidder does not exist', () => {
      beforeEach(() => {
        prisma.bidder.findUnique.mockResolvedValue(null);
      });

      it('returns null', async () => {
        await expect(db.findBidder('bidder-1' as BidderId)).resolves.toBeNull();
      });
    });
  });

  describe('readBiddingSnapshot', () => {
    const auctionRow = {
      status: 'OPEN',
      closeAt,
      floorPriceCents: 1000,
      raceEntry: { athlete: { email: 'athlete@example.com', isBanned: false } },
    };

    describe('when the auction has a leading bid', () => {
      beforeEach(() => {
        prisma.$queryRaw.mockResolvedValue([{ db_now: dbNow }] as never);
        prisma.auction.findUnique.mockResolvedValue({
          ...auctionRow,
          bids: [{ bidderId: 'bidder-1', amountCents: 5000 }],
        } as never);
      });

      it('returns the unlocked snapshot with the leader rule fields', async () => {
        await expect(db.readBiddingSnapshot(auctionId)).resolves.toEqual({
          auction: {
            status: 'OPEN',
            closeAt,
            dbNow,
            floorPriceCents: 1000,
            athleteEmail: 'athlete@example.com',
            athleteBanned: false,
          },
          leading: { bidderId: 'bidder-1', amountCents: 5000 },
        });
      });

      it('reads only the leading bid', async () => {
        await db.readBiddingSnapshot(auctionId);

        expect(prisma.auction.findUnique).toHaveBeenCalledWith({
          where: { id: auctionId },
          select: {
            status: true,
            closeAt: true,
            floorPriceCents: true,
            raceEntry: { select: { athlete: { select: { email: true, isBanned: true } } } },
            bids: { where: { status: 'LEADING' }, select: { bidderId: true, amountCents: true }, take: 1 },
          },
        });
      });

      it('neither locks nor opens a transaction', async () => {
        await db.readBiddingSnapshot(auctionId);

        const [strings] = prisma.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];

        expect(strings.join('?')).not.toContain('FOR UPDATE');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe('when the auction has no leading bid', () => {
      beforeEach(() => {
        prisma.$queryRaw.mockResolvedValue([{ db_now: dbNow }] as never);
        prisma.auction.findUnique.mockResolvedValue({ ...auctionRow, bids: [] } as never);
      });

      it('returns a null leader', async () => {
        await expect(db.readBiddingSnapshot(auctionId)).resolves.toMatchObject({ leading: null });
      });
    });

    describe('when the auction does not exist', () => {
      beforeEach(() => {
        prisma.$queryRaw.mockResolvedValue([{ db_now: dbNow }] as never);
        prisma.auction.findUnique.mockResolvedValue(null);
      });

      it('returns null', async () => {
        await expect(db.readBiddingSnapshot(auctionId)).resolves.toBeNull();
      });
    });
  });

  describe('bidExists', () => {
    describe('when the bid row exists', () => {
      beforeEach(() => {
        prisma.bid.findUnique.mockResolvedValue({ id: 'bid-2' } as never);
      });

      it('returns true', async () => {
        await expect(db.bidExists('bid-2' as BidId)).resolves.toBe(true);
        expect(prisma.bid.findUnique).toHaveBeenCalledWith({ where: { id: 'bid-2' }, select: { id: true } });
      });
    });

    describe('when the bid row does not exist', () => {
      beforeEach(() => {
        prisma.bid.findUnique.mockResolvedValue(null);
      });

      it('returns false', async () => {
        await expect(db.bidExists('bid-2' as BidId)).resolves.toBe(false);
      });
    });
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

    describe('findLeading', () => {
      const leadingSelect = {
        id: true,
        bidderId: true,
        amountCents: true,
        escrowTransactions: {
          select: { type: true, stripePaymentIntentId: true, amountCents: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      };

      describe('when the leader has an active hold', () => {
        beforeEach(() => {
          tx.bid.findFirst.mockResolvedValue({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            escrowTransactions: [{ type: 'AUTHORIZED', stripePaymentIntentId: 'pi_1', amountCents: 5000 }],
          } as never);
        });

        it('returns the leader with its hold', async () => {
          await expect(session.findLeading()).resolves.toEqual({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            hold: { paymentIntentId: 'pi_1', amountCents: 5000 },
          });
        });

        it('reads only the latest escrow row of the leading bid', async () => {
          await session.findLeading();

          expect(tx.bid.findFirst).toHaveBeenCalledWith({
            where: { auctionId, status: 'LEADING' },
            select: leadingSelect,
          });
        });
      });

      describe('when the leader has no escrow row', () => {
        beforeEach(() => {
          tx.bid.findFirst.mockResolvedValue({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            escrowTransactions: [],
          } as never);
        });

        it('returns a null hold', async () => {
          await expect(session.findLeading()).resolves.toEqual({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            hold: null,
          });
        });
      });

      describe('when the leader hold was already voided', () => {
        beforeEach(() => {
          tx.bid.findFirst.mockResolvedValue({
            id: 'bid-1',
            bidderId: 'bidder-1',
            amountCents: 5000,
            escrowTransactions: [{ type: 'VOIDED', stripePaymentIntentId: 'pi_1', amountCents: 5000 }],
          } as never);
        });

        it('returns a null hold', async () => {
          await expect(session.findLeading()).resolves.toMatchObject({ hold: null });
        });
      });

      describe('when there is no leading bid', () => {
        beforeEach(() => {
          tx.bid.findFirst.mockResolvedValue(null);
        });

        it('returns null', async () => {
          await expect(session.findLeading()).resolves.toBeNull();
        });
      });
    });

    describe('recordAuthorized', () => {
      it('inserts an AUTHORIZED row with the capture deadline', async () => {
        const captureBefore = new Date('2026-11-15T12:00:00Z');

        await session.recordAuthorized('bid-2' as BidId, {
          paymentIntentId: stripePaymentIntentId('pi_2'),
          amountCents: cents(5500),
          captureBefore,
        });

        expect(tx.escrowTransaction.create).toHaveBeenCalledWith({
          data: { bidId: 'bid-2', stripePaymentIntentId: 'pi_2', type: 'AUTHORIZED', amountCents: 5500, captureBefore },
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
