import { Logger } from '@nestjs/common';
import { AthleteDb } from '../athletes/athlete.db';
import { stripeConnectAccountId, type StripeConnectAccountId } from '../common/stripe-ids';
import type { PrismaService } from '../prisma/prisma.service';
import type { StripeGateway } from '../stripe/stripe-gateway';
import { createAthlete } from '../testing/fixture-utilities';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  type ThrowawayDatabase,
} from '../testing/throwaway-database';
import { ConnectService } from './connect.service';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = await isPostgresReachable(adminUrl);
const ONE_HOUR_MS = 3_600_000;

describe.skipIf(!reachable)('ConnectService.syncReadiness (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;

  function serviceWith(
    accountId: StripeConnectAccountId,
    payoutsEnabled: boolean,
    requirementsDue: readonly string[] = [],
  ): ConnectService {
    const gateway = {
      retrieveAccount: async () => ({
        id: accountId,
        detailsSubmitted: true,
        payoutsEnabled,
        transfersActive: payoutsEnabled,
        requirementsDue,
        disabledReason: null,
      }),
    } as unknown as StripeGateway;

    return new ConnectService(new AthleteDb(prisma), gateway);
  }

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
  });

  afterAll(async () => {
    await database?.drop();
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when synced twice', () => {
    it('leaves the same final readiness row', async () => {
      const accountId = stripeConnectAccountId('acct_int_1');
      const athlete = await createAthlete(prisma, { stripeConnectAccountId: accountId });
      const service = serviceWith(accountId, true, ['external_account']);

      await service.syncReadiness(accountId);

      const first = await prisma.athlete.findUniqueOrThrow({ where: { id: athlete.id } });

      await service.syncReadiness(accountId);

      const second = await prisma.athlete.findUniqueOrThrow({ where: { id: athlete.id } });

      expect(first.stripeConnectDetailsSubmitted).toBe(true);
      expect(first.stripeConnectPayoutsEnabled).toBe(true);
      expect(second.stripeConnectDetailsSubmitted).toBe(true);
      expect(second.stripeConnectPayoutsEnabled).toBe(true);
      expect(second.stripeConnectSyncedAt).not.toBeNull();
      expect(second.stripeConnectRequirementsDue).toEqual(['external_account']);
    });
  });

  describe('when a newer sync is already stored', () => {
    it('does not overwrite it with an older one', async () => {
      const accountId = stripeConnectAccountId('acct_int_2');
      const newer = new Date(Date.now() + ONE_HOUR_MS);
      const athlete = await createAthlete(prisma, {
        stripeConnectAccountId: accountId,
        stripeConnectDetailsSubmitted: true,
        stripeConnectPayoutsEnabled: true,
        stripeConnectSyncedAt: newer,
      });

      await serviceWith(accountId, false, ['external_account']).syncReadiness(accountId);

      const stored = await prisma.athlete.findUniqueOrThrow({ where: { id: athlete.id } });

      expect(stored.stripeConnectPayoutsEnabled).toBe(true);
      expect(stored.stripeConnectRequirementsDue).toBeNull();
      expect(stored.stripeConnectSyncedAt).toEqual(newer);
    });
  });
});
