import { Prisma } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AthleteDb } from './athlete.db';
import type { AthleteId } from '../common/ids';
import { stripeConnectAccountId } from '../common/stripe-ids';
import type { PrismaService } from '../prisma/prisma.service';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('failure', { code, clientVersion: 'test' });
}

describe('AthleteDb connect readiness', () => {
  const id = 'athlete-1' as AthleteId;
  const accountId = stripeConnectAccountId('acct_1');
  const row = { id, stripeConnectAccountId: accountId };
  let prisma: DeepMockProxy<PrismaService>;
  let db: AthleteDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    db = new AthleteDb(prisma);
  });

  describe('setStripeConnectAccountIdIfUnset', () => {
    describe('when no account id is stored yet', () => {
      it('writes only where the id is null and returns the row', async () => {
        prisma.athlete.updateMany.mockResolvedValue({ count: 1 });
        prisma.athlete.findUnique.mockResolvedValue(row as never);

        expect(await db.setStripeConnectAccountIdIfUnset(id, accountId)).toBe(row);
        expect(prisma.athlete.updateMany).toHaveBeenCalledWith({
          where: { id, stripeConnectAccountId: null },
          data: { stripeConnectAccountId: accountId },
        });
      });
    });

    describe('when an account id is already stored', () => {
      it('returns null without reading the row', async () => {
        prisma.athlete.updateMany.mockResolvedValue({ count: 0 });

        expect(await db.setStripeConnectAccountIdIfUnset(id, accountId)).toBeNull();
        expect(prisma.athlete.findUnique).not.toHaveBeenCalled();
      });
    });
  });

  describe('setStripeConnectAccountIdIfUnset when the account id belongs to another athlete', () => {
    it('returns null', async () => {
      prisma.athlete.updateMany.mockRejectedValue(prismaError('P2002'));

      expect(await db.setStripeConnectAccountIdIfUnset(id, accountId)).toBeNull();
    });
  });

  describe('findByStripeConnectAccountId', () => {
    it('queries by account id', async () => {
      prisma.athlete.findUnique.mockResolvedValue(row as never);

      expect(await db.findByStripeConnectAccountId(accountId)).toBe(row);
      expect(prisma.athlete.findUnique).toHaveBeenCalledWith({ where: { stripeConnectAccountId: accountId } });
    });

    describe('when no athlete matches', () => {
      it('returns null', async () => {
        prisma.athlete.findUnique.mockResolvedValue(null);

        expect(await db.findByStripeConnectAccountId(accountId)).toBeNull();
      });
    });
  });

  describe('updateConnectReadiness', () => {
    it('writes the readiness columns', async () => {
      const syncedAt = new Date('2026-11-02T10:00:00Z');
      prisma.athlete.update.mockResolvedValue(row as never);

      expect(await db.updateConnectReadiness(id, { detailsSubmitted: true, payoutsEnabled: false, syncedAt })).toBe(
        row,
      );
      expect(prisma.athlete.update).toHaveBeenCalledWith({
        where: { id },
        data: {
          stripeConnectDetailsSubmitted: true,
          stripeConnectPayoutsEnabled: false,
          stripeConnectSyncedAt: syncedAt,
        },
      });
    });

    describe('when the athlete does not exist', () => {
      it('returns null', async () => {
        prisma.athlete.update.mockRejectedValue(prismaError('P2025'));

        expect(
          await db.updateConnectReadiness(id, { detailsSubmitted: true, payoutsEnabled: true, syncedAt: new Date() }),
        ).toBeNull();
      });
    });
  });
});
