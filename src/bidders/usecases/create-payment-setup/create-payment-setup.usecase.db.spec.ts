import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { NormalizedEmail } from '../../../common/email';
import type { BidderId } from '../../../common/ids';
import type { StripeCustomerId } from '../../../common/stripe-ids';
import type { PrismaService } from '../../../prisma/prisma.service';
import { CreatePaymentSetupUsecaseDb } from './create-payment-setup.usecase.db';

describe('CreatePaymentSetupUsecaseDb', () => {
  const id = 'bidder-1' as BidderId;
  const customerId = 'cus_1' as StripeCustomerId;
  let prisma: DeepMockProxy<PrismaService>;
  let db: CreatePaymentSetupUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new CreatePaymentSetupUsecaseDb(prisma);
  });

  describe('upsertByEmail', () => {
    describe('when called', () => {
      it('upserts on the unique email with an empty update', async () => {
        const row = { id: 'bidder-1' };
        prisma.bidder.upsert.mockResolvedValue(row as never);

        const result = await db.upsertByEmail('jamie@x.com' as NormalizedEmail);

        expect(result).toBe(row);
        expect(prisma.bidder.upsert).toHaveBeenCalledWith({
          where: { email: 'jamie@x.com' },
          create: { email: 'jamie@x.com' },
          update: {},
        });
      });
    });
  });

  describe('findById', () => {
    describe('when called', () => {
      it('reads the row by id', async () => {
        const row = { id: 'bidder-1' };
        prisma.bidder.findUnique.mockResolvedValue(row as never);

        const result = await db.findById(id);

        expect(result).toBe(row);
        expect(prisma.bidder.findUnique).toHaveBeenCalledWith({ where: { id } });
      });
    });
  });

  describe('setStripeCustomerIdIfUnset', () => {
    describe('when the bidder exists', () => {
      it('updates only an unset customer id then re-reads the row', async () => {
        const row = { id: 'bidder-1', stripeCustomerId: 'cus_1' };
        prisma.bidder.findUnique.mockResolvedValue(row as never);

        const result = await db.setStripeCustomerIdIfUnset(id, customerId);

        expect(result).toBe(row);
        expect(prisma.bidder.updateMany).toHaveBeenCalledWith({
          where: { id, stripeCustomerId: null },
          data: { stripeCustomerId: customerId },
        });
        expect(prisma.bidder.findUnique).toHaveBeenCalledWith({ where: { id } });
      });
    });

    describe('when the bidder is gone', () => {
      it('returns null', async () => {
        prisma.bidder.findUnique.mockResolvedValue(null);

        const result = await db.setStripeCustomerIdIfUnset(id, customerId);

        expect(result).toBeNull();
      });
    });
  });
});
