import type { Prisma } from '@prisma/client';
import { ConflictError, InvalidValueError } from '../../../common/domain-error';
import { normalizeEmail } from '../../../common/email';
import type { AuctionId } from '../../../common/ids';
import { cents } from '../../../common/money';
import type { PrismaService } from '../../../prisma/prisma.service';
import { createAthlete, createAuction, createRaceEntry } from '../../../testing/fixture-utilities';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  type ThrowawayDatabase,
} from '../../../testing/throwaway-database';
import { CloseAuctionsUsecaseDb } from '../../../auctions/usecases/close-auctions/close-auctions.usecase.db';
import { minimumNextBidCents } from '../../bid-increment';
import { PlaceBidUsecase, type PlaceBidInput, type PlaceBidResult } from './place-bid.usecase';
import { PlaceBidUsecaseDb } from './place-bid.usecase.db';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = await isPostgresReachable(adminUrl);

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(result: PromiseSettledResult<PlaceBidResult>): string | null {
  if (result.status === 'fulfilled') {
    return null;
  }

  return (result.reason as { code?: string }).code ?? null;
}

describe.skipIf(!reachable)('PlaceBidUsecase (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let usecase: PlaceBidUsecase;
  let closeDb: CloseAuctionsUsecaseDb;

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
    usecase = new PlaceBidUsecase(new PlaceBidUsecaseDb(prisma));
    closeDb = new CloseAuctionsUsecaseDb(prisma);
  });

  afterAll(async () => {
    await database?.drop();
  });

  async function seedAuction(
    auctionOverrides: Partial<Prisma.AuctionUncheckedCreateInput> = {},
    athleteOverrides: Partial<Prisma.AthleteUncheckedCreateInput> = {},
  ): Promise<{ auctionId: AuctionId; athleteEmail: string }> {
    const athlete = await createAthlete(prisma, athleteOverrides);
    const entry = await createRaceEntry(prisma, { athleteId: athlete.id });
    const auction = await createAuction(prisma, { raceEntryId: entry.id, ...auctionOverrides });

    return { auctionId: auction.id as AuctionId, athleteEmail: athlete.email };
  }

  function bidAs(auctionId: AuctionId, localPart: string, amount: number): PlaceBidInput {
    return { auctionId, email: normalizeEmail(`${localPart}@example.com`), amountCents: cents(amount) };
  }

  async function holdLock(auctionId: AuctionId, closeBeforeRelease: boolean): Promise<() => Promise<void>> {
    let release: () => void = () => undefined;
    let acquired: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = prisma.$transaction(
      async (tx): Promise<void> => {
        await tx.$queryRaw`SELECT "id" FROM "auctions" WHERE "id" = ${auctionId} FOR UPDATE`;
        acquired();
        await gate;

        if (closeBeforeRelease) {
          await tx.auction.update({ where: { id: auctionId }, data: { status: 'CLOSED' } });
        }
      },
      { timeout: 20_000 },
    );

    await locked;

    return async (): Promise<void> => {
      release();
      await holder;
    };
  }

  function bidsOf(auctionId: AuctionId): Promise<Array<{ id: string; amountCents: number; status: string }>> {
    return prisma.bid.findMany({ where: { auctionId }, orderBy: { placedAt: 'asc' } });
  }

  describe('when six bidders race the same valid amount', () => {
    it('lets exactly one win and rejects the rest', async () => {
      const { auctionId } = await seedAuction();

      const results = await Promise.allSettled(
        [0, 1, 2, 3, 4, 5].map((index) => usecase.execute(bidAs(auctionId, `same-${index}`, 1500))),
      );

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const codes = results.map(errorCode).filter((code) => code !== null);
      const bids = await bidsOf(auctionId);
      const auction = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });

      expect(fulfilled).toHaveLength(1);
      expect(codes).toEqual(Array(5).fill('bid_below_minimum'));
      expect(bids.filter((bid) => bid.status === 'LEADING')).toHaveLength(1);
      expect(auction.currentLeadingBidId).toBe(bids[0].id);
    });
  });

  describe('when bidders race with ascending distinct amounts', () => {
    it('keeps one leader and a strictly increasing history', async () => {
      const { auctionId } = await seedAuction();
      const amounts = [0, 1, 2, 3, 4, 5].map((index) => 1000 + 600 * index);
      const shuffled = [amounts[3], amounts[0], amounts[5], amounts[1], amounts[4], amounts[2]];

      const results = await Promise.allSettled(
        shuffled.map((amount) => usecase.execute(bidAs(auctionId, `asc-${amount}`, amount))),
      );

      const accepted = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value.bid] : []));
      const bids = await bidsOf(auctionId);
      const auction = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
      const leading = bids.filter((bid) => bid.status === 'LEADING');

      expect(leading).toHaveLength(1);
      expect(leading[0].amountCents).toBe(Math.max(...accepted.map((bid) => bid.amountCents)));
      expect(bids.filter((bid) => bid.status === 'OUTBID')).toHaveLength(accepted.length - 1);
      expect(auction.currentLeadingBidId).toBe(leading[0].id);

      for (let i = 1; i < bids.length; i++) {
        expect(bids[i].amountCents).toBeGreaterThanOrEqual(minimumNextBidCents(cents(bids[i - 1].amountCents), cents(1000)));
      }

      for (const result of results) {
        if (result.status === 'rejected') {
          expect(errorCode(result)).toBe('bid_below_minimum');
        }
      }
    });
  });

  describe('when the same bidder fires twice at once', () => {
    it('accepts one and rejects the other as already leading', async () => {
      const { auctionId } = await seedAuction();

      const results = await Promise.allSettled([
        usecase.execute(bidAs(auctionId, 'twice', 1500)),
        usecase.execute(bidAs(auctionId, 'twice', 1500)),
      ]);

      const bidders = await prisma.bidder.count({ where: { email: 'twice@example.com' } });

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.map(errorCode).filter((code) => code !== null)).toEqual(['already_leading']);
      expect(bidders).toBe(1);
    });
  });

  describe('when a rejected bid would have created a new bidder', () => {
    it('leaves no bidder row after a self-bid', async () => {
      const { auctionId, athleteEmail } = await seedAuction();

      await expect(
        usecase.execute({ auctionId, email: normalizeEmail(athleteEmail), amountCents: cents(1500) }),
      ).rejects.toMatchObject({ code: 'self_bid_not_allowed' });

      expect(await prisma.bidder.count({ where: { email: athleteEmail } })).toBe(0);
    });

    it('leaves no bidder row after a below-floor bid', async () => {
      const { auctionId } = await seedAuction();

      await expect(usecase.execute(bidAs(auctionId, 'fresh-low', 999))).rejects.toThrow(
        new InvalidValueError('bid_below_minimum'),
      );

      expect(await prisma.bidder.count({ where: { email: 'fresh-low@example.com' } })).toBe(0);
    });
  });

  describe('when the lock is held by another transaction', () => {
    it('waits, then rejects after the auction is closed', async () => {
      const { auctionId } = await seedAuction();
      const releaseLock = await holdLock(auctionId, true);
      let settled = false;
      const pending = usecase.execute(bidAs(auctionId, 'waiter', 1500)).finally(() => {
        settled = true;
      });
      const outcome = pending.then(
        () => null,
        (error: unknown) => error,
      );

      await sleep(300);
      expect(settled).toBe(false);

      await releaseLock();

      expect(await outcome).toEqual(new ConflictError('auction_not_open'));
      expect(await bidsOf(auctionId)).toHaveLength(0);
    });
  });

  describe('when a bid races the close job', () => {
    it('never leaves a LEADING bid on a closed auction', async () => {
      for (let iteration = 0; iteration < 25; iteration++) {
        const closeAt = new Date(Date.now() + 10 + iteration * 4);
        const { auctionId } = await seedAuction({ closeAt });

        const [bidResult] = await Promise.allSettled([
          usecase.execute(bidAs(auctionId, `racer-${iteration}`, 1500)),
          closeDb.closeAuction(auctionId, closeAt, new Date(closeAt.getTime() + 86_400_000)),
        ]);

        const auction = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
        const bids = await bidsOf(auctionId);

        expect(auction.status).toBe('CLOSED');
        expect(bids.filter((bid) => bid.status === 'LEADING')).toHaveLength(0);

        if (bidResult.status === 'fulfilled') {
          expect(bids).toHaveLength(1);
          expect(bids[0].status).toBe('WON');
          expect(auction.outcome).toBe('AWAITING_PROOF');
        } else {
          expect(errorCode(bidResult)).toBe('auction_not_open');
          expect(bids).toHaveLength(0);
          expect(auction.outcome).toBe('NO_SALE');
        }
      }
    });
  });

  describe('when the seller is banned', () => {
    it('rejects as not open', async () => {
      const { auctionId } = await seedAuction({}, { isBanned: true });

      await expect(usecase.execute(bidAs(auctionId, 'banned-seller', 1500))).rejects.toThrow(
        new ConflictError('auction_not_open'),
      );
    });
  });
});
