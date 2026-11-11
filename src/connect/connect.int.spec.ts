import { Logger } from '@nestjs/common';
import { AthleteDb } from '../athletes/athlete.db';
import type { AthleteId } from '../common/ids';
import type { StripeConnectAccountId } from '../common/stripe-ids';
import type { PrismaService } from '../prisma/prisma.service';
import { StripeGateway, type ConnectAccountSnapshot } from '../stripe/stripe-gateway';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  type ThrowawayDatabase,
} from '../testing/throwaway-database';
import { createAthlete } from '../testing/fixture-utilities';
import { ConnectService } from './connect.service';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = await isPostgresReachable(adminUrl);
const CONCURRENT_REQUESTS = 8;

describe.skipIf(!reachable)('ConnectService (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let service: ConnectService;
  let created: number;
  let release: () => void;
  let latch: Promise<void>;
  let linkedAccounts: StripeConnectAccountId[];

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
  });

  afterAll(async () => {
    await database?.drop();
  });

  beforeEach(() => {
    created = 0;
    latch = new Promise<void>((resolve) => {
      release = resolve;
    });
    linkedAccounts = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const gateway = {
      createExpressAccount: async (): Promise<ConnectAccountSnapshot> => {
        created += 1;

        const accountNumber = created;

        if (created === CONCURRENT_REQUESTS) {
          release();
        }

        await latch;

        return {
          id: `acct_race_${accountNumber}` as StripeConnectAccountId,
          detailsSubmitted: false,
          payoutsEnabled: false,
          transfersActive: false,
          requirementsDue: [],
          disabledReason: null,
        };
      },
      createOnboardingLink: async (accountId: StripeConnectAccountId): Promise<{ url: string; expiresAt: Date }> => {
        linkedAccounts.push(accountId);

        return { url: `https://connect.stripe.test/${accountId}`, expiresAt: new Date() };
      },
    } as unknown as StripeGateway;

    service = new ConnectService(new AthleteDb(prisma), gateway);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when link requests for one athlete run concurrently', () => {
    it('stores exactly one account id and links every request to it', async () => {
      const athlete = await createAthlete(prisma, { isAdult: true, adultAttestedAt: new Date() });
      const athleteId = athlete.id as AthleteId;

      await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, () => service.createOnboardingLink(athleteId)));

      const stored = await prisma.athlete.findUniqueOrThrow({ where: { id: athlete.id } });

      expect(created).toBe(CONCURRENT_REQUESTS);
      expect(stored.stripeConnectAccountId).toMatch(/^acct_race_/);
      expect(new Set(linkedAccounts)).toEqual(new Set([stored.stripeConnectAccountId]));
      expect(linkedAccounts).toHaveLength(CONCURRENT_REQUESTS);
    });
  });
});
