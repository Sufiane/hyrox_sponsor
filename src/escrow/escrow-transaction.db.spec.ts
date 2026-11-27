import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { BidId } from '../common/ids';
import { cents } from '../common/money';
import { stripePaymentIntentId } from '../common/stripe-ids';
import type { PrismaService } from '../prisma/prisma.service';
import { EscrowTransactionDb } from './escrow-transaction.db';

describe('EscrowTransactionDb', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let db: EscrowTransactionDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new EscrowTransactionDb(prisma);
  });

  describe('recordVoided', () => {
    it('inserts a VOIDED row and skips duplicates', async () => {
      await db.recordVoided({
        bidId: 'bid-1' as BidId,
        paymentIntentId: stripePaymentIntentId('pi_1'),
        amountCents: cents(5_000),
      });

      expect(prisma.escrowTransaction.createMany).toHaveBeenCalledWith({
        data: [{ bidId: 'bid-1', stripePaymentIntentId: 'pi_1', type: 'VOIDED', amountCents: 5_000 }],
        skipDuplicates: true,
      });
    });
  });
});
