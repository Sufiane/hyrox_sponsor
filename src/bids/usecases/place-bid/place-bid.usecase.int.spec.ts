import { JwtService } from '@nestjs/jwt';
import { mockDeep } from 'vitest-mock-extended';
import type { Prisma } from '@prisma/client';
import { BidderTokenService } from '../../../bidders/bidder-token.service';
import { ConflictError, UnauthorizedError } from '../../../common/domain-error';
import { bidderId, type AuctionId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { stripePaymentIntentId } from '../../../common/stripe-ids';
import { EscrowTransactionDb } from '../../../escrow/escrow-transaction.db';
import { EscrowTransactionService } from '../../../escrow/escrow-transaction.service';
import type { StripeGateway } from '../../../stripe/stripe-gateway';
import type { PrismaService } from '../../../prisma/prisma.service';
import { createAthlete, createAuction, createBidder, createRaceEntry } from '../../../testing/fixture-utilities';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../../../testing/throwaway-database';
import { CloseAuctionsUsecaseDb } from '../../../auctions/usecases/close-auctions/close-auctions.usecase.db';
import { minimumNextBidCents } from '../../bid-increment';
import { PlaceBidUsecase, type PlaceBidInput, type PlaceBidResult } from './place-bid.usecase';
import { PlaceBidUsecaseDb } from './place-bid.usecase.db';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const SECRET = 'place-bid-int-secret-at-least-32-characters';
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);

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
  let tokens: BidderTokenService;
  let closeDb: CloseAuctionsUsecaseDb;
  let authorized: string[];
  let canceled: string[];
  let decline: boolean;

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
    tokens = new BidderTokenService(new JwtService({ secret: SECRET }), { ttlSeconds: 900 });
    const gateway = mockDeep<StripeGateway>();

    gateway.authorizeHold.mockImplementation(async (holdInput) => {
      if (decline) {
        return { outcome: 'declined', reason: 'insufficient_funds' };
      }

      const paymentIntentId = stripePaymentIntentId(`pi_${holdInput.attemptId.replaceAll('-', '')}`);

      authorized.push(paymentIntentId);

      return { outcome: 'authorized', paymentIntentId, captureBefore: null };
    });
    gateway.cancelHold.mockImplementation(async (paymentIntentId) => {
      canceled.push(paymentIntentId);
    });
    usecase = new PlaceBidUsecase(
      new PlaceBidUsecaseDb(prisma),
      tokens,
      gateway,
      new EscrowTransactionService(new EscrowTransactionDb(prisma), gateway),
    );
    closeDb = new CloseAuctionsUsecaseDb(prisma);
  });

  beforeEach(() => {
    authorized = [];
    canceled = [];
    decline = false;
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

  async function cardedBidderToken(localPart: string): Promise<string> {
    const bidder = await createBidder(prisma, {
      email: `${localPart}@example.com`,
      stripeCustomerId: `cus_${localPart}`,
      defaultPaymentMethodId: `pm_${localPart}`,
      cardBrand: 'visa',
      cardLast4: '4242',
    });
    const issued = await tokens.issue(bidderId(bidder.id), bidder.tokenVersion);

    return issued.token;
  }

  async function bidAs(auctionId: AuctionId, localPart: string, amount: number): Promise<PlaceBidInput> {
    return { auctionId, bidderToken: await cardedBidderToken(localPart), amountCents: cents(amount) };
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

  function escrowOf(
    auctionId: AuctionId,
  ): Promise<Array<{ bidId: string; type: string; stripePaymentIntentId: string; amountCents: number }>> {
    return prisma.escrowTransaction.findMany({ where: { bid: { auctionId } }, orderBy: { createdAt: 'asc' } });
  }

  describe('when six bidders race the same valid amount', () => {
    it('lets exactly one win and rejects the rest', async () => {
      const { auctionId } = await seedAuction();
      const inputs = await Promise.all([0, 1, 2, 3, 4, 5].map((index) => bidAs(auctionId, `same-${index}`, 1500)));

      const results = await Promise.allSettled(inputs.map((bidInput) => usecase.execute(bidInput)));

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const codes = results.map(errorCode).filter((code) => code !== null);
      const bids = await bidsOf(auctionId);
      const auction = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });

      expect(fulfilled).toHaveLength(1);
      expect(codes).toEqual(Array(5).fill('bid_below_minimum'));
      expect(bids.filter((bid) => bid.status === 'LEADING')).toHaveLength(1);
      expect(auction.currentLeadingBidId).toBe(bids[0].id);
    });

    it('keeps exactly one hold on the winner and cancels every loser hold', async () => {
      const { auctionId } = await seedAuction();
      const inputs = await Promise.all([0, 1, 2, 3, 4, 5].map((index) => bidAs(auctionId, `hold-same-${index}`, 1500)));

      await Promise.allSettled(inputs.map((bidInput) => usecase.execute(bidInput)));

      const rows = await escrowOf(auctionId);
      const leading = (await bidsOf(auctionId)).filter((bid) => bid.status === 'LEADING');

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ bidId: leading[0].id, type: 'AUTHORIZED', amountCents: 1500 });
      expect([...canceled].sort()).toEqual(authorized.filter((id) => id !== rows[0].stripePaymentIntentId).sort());
    });
  });

  describe('when a held leader is outbid', () => {
    it('voids the previous hold exactly once', async () => {
      const { auctionId } = await seedAuction();
      const first = await usecase.execute(await bidAs(auctionId, 'hold-first', 1500));
      const second = await usecase.execute(await bidAs(auctionId, 'hold-second', 2000));

      const rows = await escrowOf(auctionId);
      const firstRows = rows.filter((row) => row.bidId === first.bid.id);
      const secondRows = rows.filter((row) => row.bidId === second.bid.id);

      expect(firstRows.map((row) => row.type)).toEqual(['AUTHORIZED', 'VOIDED']);
      expect(firstRows[1]).toMatchObject({
        stripePaymentIntentId: firstRows[0].stripePaymentIntentId,
        amountCents: 1500,
      });
      expect(secondRows.map((row) => row.type)).toEqual(['AUTHORIZED']);
      expect(canceled).toEqual([firstRows[0].stripePaymentIntentId]);
    });
  });

  describe('when the card is declined', () => {
    it('writes no bid and no escrow row', async () => {
      const { auctionId } = await seedAuction();
      const bidInput = await bidAs(auctionId, 'hold-declined', 1500);

      decline = true;

      await expect(usecase.execute(bidInput)).rejects.toMatchObject({ code: 'card_declined' });
      expect(await bidsOf(auctionId)).toHaveLength(0);
      expect(await escrowOf(auctionId)).toHaveLength(0);
    });
  });

  describe('when bidders race with ascending distinct amounts', () => {
    it('keeps one leader and a strictly increasing history', async () => {
      const { auctionId } = await seedAuction();
      const amounts = [0, 1, 2, 3, 4, 5].map((index) => 1000 + 600 * index);
      const shuffled = [amounts[3], amounts[0], amounts[5], amounts[1], amounts[4], amounts[2]];

      const inputs = await Promise.all(shuffled.map((amount) => bidAs(auctionId, `asc-${amount}`, amount)));

      const results = await Promise.allSettled(inputs.map((bidInput) => usecase.execute(bidInput)));

      const accepted = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value.bid] : []));
      const bids = await bidsOf(auctionId);
      const auction = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
      const leading = bids.filter((bid) => bid.status === 'LEADING');

      expect(leading).toHaveLength(1);
      expect(leading[0].amountCents).toBe(Math.max(...accepted.map((bid) => bid.amountCents)));
      expect(bids.filter((bid) => bid.status === 'OUTBID')).toHaveLength(accepted.length - 1);
      expect(auction.currentLeadingBidId).toBe(leading[0].id);

      for (let i = 1; i < bids.length; i++) {
        expect(bids[i].amountCents).toBeGreaterThanOrEqual(
          minimumNextBidCents(cents(bids[i - 1].amountCents), cents(1000)),
        );
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
      const bidInput = await bidAs(auctionId, 'twice', 1500);

      const results = await Promise.allSettled([usecase.execute(bidInput), usecase.execute(bidInput)]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.map(errorCode).filter((code) => code !== null)).toEqual(['already_leading']);
      expect(canceled).toHaveLength(authorized.length - 1);
      expect((await escrowOf(auctionId)).map((row) => row.stripePaymentIntentId)).toEqual(
        authorized.filter((id) => id !== canceled[0]),
      );
    });
  });

  describe('when the bidder email is the athlete email', () => {
    it('rejects the self-bid', async () => {
      const { auctionId, athleteEmail } = await seedAuction();
      const localPart = athleteEmail.split('@')[0];
      const bidder = await createBidder(prisma, {
        email: athleteEmail,
        stripeCustomerId: `cus_self_${localPart}`,
        defaultPaymentMethodId: 'pm_self',
        cardBrand: 'visa',
        cardLast4: '4242',
      });
      const issued = await tokens.issue(bidderId(bidder.id), bidder.tokenVersion);

      await expect(
        usecase.execute({ auctionId, bidderToken: issued.token, amountCents: cents(1500) }),
      ).rejects.toMatchObject({ code: 'self_bid_not_allowed' });
    });
  });

  describe('when the bidder has no card', () => {
    it('rejects as card required and writes no bid', async () => {
      const { auctionId } = await seedAuction();
      const bidder = await createBidder(prisma, { email: 'no-card@example.com' });
      const issued = await tokens.issue(bidderId(bidder.id), bidder.tokenVersion);

      await expect(
        usecase.execute({ auctionId, bidderToken: issued.token, amountCents: cents(1500) }),
      ).rejects.toMatchObject({ code: 'card_required' });
      expect(await bidsOf(auctionId)).toHaveLength(0);
    });
  });

  describe('when the card was saved after the token was issued', () => {
    it('rejects the stale token', async () => {
      const { auctionId } = await seedAuction();
      const bidder = await createBidder(prisma, { email: 'late-card@example.com', stripeCustomerId: 'cus_late' });
      const issued = await tokens.issue(bidderId(bidder.id), bidder.tokenVersion);

      await prisma.$executeRaw`
        UPDATE "bidders" SET "default_payment_method_id" = 'pm_late', "card_brand" = 'visa', "card_last4" = '4242'
        WHERE "id" = ${bidder.id}`;

      await expect(usecase.execute({ auctionId, bidderToken: issued.token, amountCents: cents(1500) })).rejects.toThrow(
        new UnauthorizedError('bidder_token_required'),
      );
      expect(await bidsOf(auctionId)).toHaveLength(0);
    });
  });

  describe('when the lock is held by another transaction', () => {
    it('waits, then rejects after the auction is closed', async () => {
      const { auctionId } = await seedAuction();
      const bidInput = await bidAs(auctionId, 'waiter', 1500);
      const releaseLock = await holdLock(auctionId, true);
      let settled = false;
      const pending = usecase.execute(bidInput).finally(() => {
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
      expect(authorized).toHaveLength(1);
      expect(canceled).toEqual(authorized);
    });
  });

  describe('when a bid races the close job', () => {
    it('never leaves a LEADING bid on a closed auction', async () => {
      for (let iteration = 0; iteration < 25; iteration++) {
        authorized = [];
        canceled = [];
        const bidderToken = await cardedBidderToken(`racer-${iteration}`);
        const closeAt = new Date(Date.now() + 10 + iteration * 4);
        const { auctionId } = await seedAuction({ closeAt });

        const [bidResult] = await Promise.allSettled([
          usecase.execute({ auctionId, bidderToken, amountCents: cents(1500) }),
          closeDb.closeAuction(auctionId, closeAt, new Date(closeAt.getTime() + 86_400_000)),
        ]);

        const auction = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
        const bids = await bidsOf(auctionId);
        const rows = await escrowOf(auctionId);

        expect(auction.status).toBe('CLOSED');
        expect(bids.filter((bid) => bid.status === 'LEADING')).toHaveLength(0);

        if (bidResult.status === 'fulfilled') {
          expect(bids).toHaveLength(1);
          expect(bids[0].status).toBe('WON');
          expect(auction.outcome).toBe('AWAITING_PROOF');
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ bidId: bids[0].id, type: 'AUTHORIZED' });
          expect(canceled).toHaveLength(0);
        } else {
          expect(errorCode(bidResult)).toBe('auction_not_open');
          expect(bids).toHaveLength(0);
          expect(auction.outcome).toBe('NO_SALE');
          expect(rows).toHaveLength(0);
          expect(canceled).toEqual(authorized);
        }
      }
    });
  });

  describe('when the seller is banned', () => {
    it('rejects as not open', async () => {
      const { auctionId } = await seedAuction({}, { isBanned: true });

      await expect(usecase.execute(await bidAs(auctionId, 'banned-seller', 1500))).rejects.toThrow(
        new ConflictError('auction_not_open'),
      );
    });
  });
});
