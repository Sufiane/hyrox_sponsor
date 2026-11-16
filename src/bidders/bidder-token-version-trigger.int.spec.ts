import type { PrismaService } from '../prisma/prisma.service';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../testing/throwaway-database';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);

async function versionOf(prisma: PrismaService, email: string): Promise<number> {
  const row = await prisma.bidder.findUniqueOrThrow({ where: { email } });

  return row.tokenVersion;
}

describe.skipIf(!reachable)('bidders token_version trigger (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
  });

  afterEach(async () => {
    await prisma.bidder.deleteMany();
  });

  afterAll(async () => {
    await database?.drop();
  });

  describe('when a bidder is inserted with a card', () => {
    it('starts at version 0', async () => {
      await prisma.bidder.create({
        data: { email: 'insert@x.com', defaultPaymentMethodId: 'pm_1', cardBrand: 'visa', cardLast4: '4242' },
      });

      expect(await versionOf(prisma, 'insert@x.com')).toBe(0);
    });
  });

  describe('when default_payment_method_id changes', () => {
    beforeEach(async () => {
      await prisma.bidder.create({ data: { email: 'card@x.com' } });
    });

    it('bumps the version once when the card is set', async () => {
      await prisma.$executeRaw`
        UPDATE "bidders"
        SET "default_payment_method_id" = 'pm_1', "card_brand" = 'visa', "card_last4" = '4242'
        WHERE "email" = 'card@x.com'`;

      expect(await versionOf(prisma, 'card@x.com')).toBe(1);
    });

    it('does not double-bump when the statement also increments the version', async () => {
      await prisma.$executeRaw`
        UPDATE "bidders"
        SET "default_payment_method_id" = 'pm_1', "card_brand" = 'visa', "card_last4" = '4242',
            "token_version" = "token_version" + 1
        WHERE "email" = 'card@x.com'`;

      expect(await versionOf(prisma, 'card@x.com')).toBe(1);
    });

    it('bumps the version when the card is cleared', async () => {
      await prisma.$executeRaw`
        UPDATE "bidders"
        SET "default_payment_method_id" = 'pm_1', "card_brand" = 'visa', "card_last4" = '4242'
        WHERE "email" = 'card@x.com'`;
      await prisma.$executeRaw`
        UPDATE "bidders"
        SET "default_payment_method_id" = NULL, "card_brand" = NULL, "card_last4" = NULL
        WHERE "email" = 'card@x.com'`;

      expect(await versionOf(prisma, 'card@x.com')).toBe(2);
    });
  });

  describe('when default_payment_method_id is set to its current value', () => {
    it('leaves the version alone', async () => {
      await prisma.bidder.create({
        data: { email: 'same@x.com', defaultPaymentMethodId: 'pm_1', cardBrand: 'visa', cardLast4: '4242' },
      });
      await prisma.$executeRaw`
        UPDATE "bidders" SET "default_payment_method_id" = 'pm_1' WHERE "email" = 'same@x.com'`;

      expect(await versionOf(prisma, 'same@x.com')).toBe(0);
    });
  });

  describe('when another column changes', () => {
    beforeEach(async () => {
      await prisma.bidder.create({ data: { email: 'other@x.com' } });
    });

    it('leaves the version alone for the stripe customer id', async () => {
      await prisma.bidder.update({ where: { email: 'other@x.com' }, data: { stripeCustomerId: 'cus_trigger_1' } });

      expect(await versionOf(prisma, 'other@x.com')).toBe(0);
    });

    it('leaves the version alone for the email', async () => {
      await prisma.bidder.update({ where: { email: 'other@x.com' }, data: { email: 'renamed@x.com' } });

      expect(await versionOf(prisma, 'renamed@x.com')).toBe(0);
    });
  });
});
