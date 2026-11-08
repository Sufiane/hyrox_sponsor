import { Prisma } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaService } from '../../prisma/prisma.service';
import { StripeWebhookEventDb } from './stripe-webhook-event.db';

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test' });
}

describe('StripeWebhookEventDb', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let db: StripeWebhookEventDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new StripeWebhookEventDb(prisma);
  });

  describe('insertIfNew', () => {
    describe('when the event id is new', () => {
      it('returns true and stores the channel as an enum value', async () => {
        prisma.stripeWebhookEvent.create.mockResolvedValue({} as never);

        await expect(db.insertIfNew({ id: 'evt_1', type: 'account.updated', channel: 'connect' })).resolves.toBe(true);

        expect(prisma.stripeWebhookEvent.create).toHaveBeenCalledWith({
          data: { id: 'evt_1', type: 'account.updated', channel: 'CONNECT' },
        });
      });
    });

    describe('when the event id already exists', () => {
      it('returns false', async () => {
        prisma.stripeWebhookEvent.create.mockRejectedValue(knownError('P2002'));

        await expect(db.insertIfNew({ id: 'evt_1', type: 'x', channel: 'platform' })).resolves.toBe(false);
      });
    });

    describe('when the insert fails for another reason', () => {
      it('rethrows the error', async () => {
        const failure = knownError('P1001');

        prisma.stripeWebhookEvent.create.mockRejectedValue(failure);

        await expect(db.insertIfNew({ id: 'evt_1', type: 'x', channel: 'platform' })).rejects.toBe(failure);
      });
    });
  });

  describe('claim', () => {
    const staleBefore = new Date('2026-11-01T09:59:00Z');

    describe('when an unprocessed, unclaimed or stale-claimed row exists', () => {
      it('returns true and filters on processed and claim state', async () => {
        prisma.stripeWebhookEvent.updateMany.mockResolvedValue({ count: 1 });

        await expect(db.claim('evt_1', staleBefore)).resolves.toBe(true);

        expect(prisma.stripeWebhookEvent.updateMany).toHaveBeenCalledWith({
          where: { id: 'evt_1', processedAt: null, OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] },
          data: { claimedAt: expect.any(Date) },
        });
      });
    });

    describe('when the row is processed or freshly claimed', () => {
      it('returns false', async () => {
        prisma.stripeWebhookEvent.updateMany.mockResolvedValue({ count: 0 });

        await expect(db.claim('evt_1', staleBefore)).resolves.toBe(false);
      });
    });
  });

  describe('release', () => {
    it('clears claimedAt only on unprocessed rows', async () => {
      prisma.stripeWebhookEvent.updateMany.mockResolvedValue({ count: 1 });

      await db.release('evt_1');

      expect(prisma.stripeWebhookEvent.updateMany).toHaveBeenCalledWith({
        where: { id: 'evt_1', processedAt: null },
        data: { claimedAt: null },
      });
    });
  });

  describe('markProcessed', () => {
    it('sets processedAt on the row', async () => {
      const processedAt = new Date('2026-11-01T10:00:00Z');

      prisma.stripeWebhookEvent.updateMany.mockResolvedValue({ count: 1 });

      await db.markProcessed('evt_1', processedAt);

      expect(prisma.stripeWebhookEvent.updateMany).toHaveBeenCalledWith({
        where: { id: 'evt_1' },
        data: { processedAt },
      });
    });
  });
});
