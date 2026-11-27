import type { BidId } from '../common/ids';
import { cents } from '../common/money';
import { stripePaymentIntentId, type StripePaymentIntentId } from '../common/stripe-ids';
import type { PrismaService } from '../prisma/prisma.service';
import { createAthlete, createAuction, createBidder, createRaceEntry } from '../testing/fixture-utilities';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../testing/throwaway-database';
import { EscrowTransactionDb } from './escrow-transaction.db';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);

describe.skipIf(!reachable)('EscrowTransactionDb (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let db: EscrowTransactionDb;
  let bidId: BidId;
  let paymentIntentId: StripePaymentIntentId;

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
    db = new EscrowTransactionDb(prisma);
  });

  beforeEach(async () => {
    const athlete = await createAthlete(prisma);
    const entry = await createRaceEntry(prisma, { athleteId: athlete.id });
    const auction = await createAuction(prisma, { raceEntryId: entry.id });
    const bidder = await createBidder(prisma);
    const bid = await prisma.bid.create({
      data: { auctionId: auction.id, bidderId: bidder.id, amountCents: 5_000, status: 'OUTBID' },
    });
    bidId = bid.id as BidId;
    paymentIntentId = stripePaymentIntentId(`pi_${bid.id}`);
  });

  afterAll(async () => {
    await database?.drop();
  });

  describe('when the same hold is voided twice', () => {
    it('keeps one VOIDED row', async () => {
      const release = { bidId, paymentIntentId, amountCents: cents(5_000) };

      await db.recordVoided(release);
      await db.recordVoided(release);

      expect(await prisma.escrowTransaction.count({ where: { stripePaymentIntentId: paymentIntentId } })).toBe(1);
    });
  });

  describe('when a hold is authorized then voided', () => {
    it('keeps both rows', async () => {
      await prisma.escrowTransaction.create({
        data: { bidId, stripePaymentIntentId: paymentIntentId, type: 'AUTHORIZED', amountCents: 5_000 },
      });
      await db.recordVoided({ bidId, paymentIntentId, amountCents: cents(5_000) });

      expect(await prisma.escrowTransaction.count({ where: { stripePaymentIntentId: paymentIntentId } })).toBe(2);
    });
  });

  describe('when a second AUTHORIZED row is inserted for one intent', () => {
    it('is rejected by the unique index', async () => {
      await prisma.escrowTransaction.create({
        data: { bidId, stripePaymentIntentId: paymentIntentId, type: 'AUTHORIZED', amountCents: 5_000 },
      });

      await expect(
        prisma.escrowTransaction.create({
          data: { bidId, stripePaymentIntentId: paymentIntentId, type: 'AUTHORIZED', amountCents: 5_000 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
