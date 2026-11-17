import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { StripeCustomerId, StripePaymentMethodId } from '../../../common/stripe-ids';
import type { PrismaService } from '../../../prisma/prisma.service';
import { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

describe('SyncPaymentMethodUsecaseDb', () => {
  const customerId = 'cus_1' as StripeCustomerId;
  const paymentMethodId = 'pm_1' as StripePaymentMethodId;
  const input = { customerId, paymentMethodId, brand: 'visa', last4: '4242' };
  let prisma: DeepMockProxy<PrismaService>;
  let db: SyncPaymentMethodUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new SyncPaymentMethodUsecaseDb(prisma);
  });

  describe('findByStripeCustomerId', () => {
    it('looks the bidder up by the unique customer id', async () => {
      prisma.bidder.findUnique.mockResolvedValue(null);

      await db.findByStripeCustomerId(customerId);

      expect(prisma.bidder.findUnique).toHaveBeenCalledWith({ where: { stripeCustomerId: customerId } });
    });
  });

  describe('saveFirstCard', () => {
    it('writes card and version bump in one conditional update', async () => {
      prisma.bidder.updateMany.mockResolvedValue({ count: 1 });

      await db.saveFirstCard(input);

      expect(prisma.bidder.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.bidder.updateMany).toHaveBeenCalledWith({
        where: { stripeCustomerId: customerId, defaultPaymentMethodId: null },
        data: {
          defaultPaymentMethodId: paymentMethodId,
          cardBrand: 'visa',
          cardLast4: '4242',
          tokenVersion: { increment: 1 },
        },
      });
    });

    describe('when a row was updated', () => {
      it('returns true', async () => {
        prisma.bidder.updateMany.mockResolvedValue({ count: 1 });

        expect(await db.saveFirstCard(input)).toBe(true);
      });
    });

    describe('when no row matched', () => {
      it('returns false', async () => {
        prisma.bidder.updateMany.mockResolvedValue({ count: 0 });

        expect(await db.saveFirstCard(input)).toBe(false);
      });
    });
  });
});
