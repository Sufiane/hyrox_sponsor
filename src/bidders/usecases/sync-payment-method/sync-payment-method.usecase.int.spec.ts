import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { BidderId } from '../../../common/ids';
import { stripeCustomerId, stripePaymentMethodId, stripeSetupIntentId } from '../../../common/stripe-ids';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { StripeGateway } from '../../../stripe/stripe-gateway';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../../../testing/throwaway-database';
import { BidderTokenService } from '../../bidder-token.service';
import { SyncPaymentMethodUsecase } from './sync-payment-method.usecase';
import { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);

describe.skipIf(!reachable)('SyncPaymentMethodUsecase (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let usecase: SyncPaymentMethodUsecase;
  const ownerByPaymentMethod = new Map<string, string>();
  let beforeGatewayReturns: () => Promise<void> = async (): Promise<void> => undefined;

  function commandFor(customer: string, paymentMethod: string): Parameters<SyncPaymentMethodUsecase['execute']>[0] {
    ownerByPaymentMethod.set(paymentMethod, customer);

    return {
      setupIntentId: stripeSetupIntentId(`seti_${paymentMethod}`),
      customerId: stripeCustomerId(customer),
      paymentMethodId: stripePaymentMethodId(paymentMethod),
    };
  }

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
    const gateway = {
      retrievePaymentMethod: async (id: string) => {
        await beforeGatewayReturns();

        return {
          id,
          customerId: stripeCustomerId(ownerByPaymentMethod.get(id) ?? 'cus_unset'),
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2030,
        };
      },
    } as unknown as StripeGateway;

    usecase = new SyncPaymentMethodUsecase(new SyncPaymentMethodUsecaseDb(prisma), gateway);
  });

  afterAll(async () => {
    await database?.drop();
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    beforeGatewayReturns = async (): Promise<void> => undefined;
    vi.restoreAllMocks();
  });

  describe('when a bidder without a card gets its first event', () => {
    it('saves the card and bumps the version exactly once', async () => {
      await prisma.bidder.create({ data: { email: 'first@x.com', stripeCustomerId: 'cus_first' } });

      expect(await usecase.execute(commandFor('cus_first', 'pm_first'))).toBe('saved');

      const row = await prisma.bidder.findUniqueOrThrow({ where: { email: 'first@x.com' } });

      expect(row).toMatchObject({
        defaultPaymentMethodId: 'pm_first',
        cardBrand: 'visa',
        cardLast4: '4242',
        tokenVersion: 1,
      });
    });
  });

  describe('when the same event is processed twice', () => {
    it('keeps one write and one version bump', async () => {
      await prisma.bidder.create({ data: { email: 'replay@x.com', stripeCustomerId: 'cus_replay' } });

      await usecase.execute(commandFor('cus_replay', 'pm_replay'));

      expect(await usecase.execute(commandFor('cus_replay', 'pm_replay'))).toBe('already_saved');
      expect((await prisma.bidder.findUniqueOrThrow({ where: { email: 'replay@x.com' } })).tokenVersion).toBe(1);
    });
  });

  describe('when a second card arrives', () => {
    it('is ignored and leaves the first card and version', async () => {
      await prisma.bidder.create({ data: { email: 'second@x.com', stripeCustomerId: 'cus_second' } });

      await usecase.execute(commandFor('cus_second', 'pm_one'));

      expect(await usecase.execute(commandFor('cus_second', 'pm_two'))).toBe('ignored_existing_card');

      const row = await prisma.bidder.findUniqueOrThrow({ where: { email: 'second@x.com' } });

      expect(row).toMatchObject({ defaultPaymentMethodId: 'pm_one', tokenVersion: 1 });
    });
  });

  describe('when the customer is unknown', () => {
    it('writes nothing', async () => {
      await prisma.bidder.create({ data: { email: 'bystander@x.com', stripeCustomerId: 'cus_bystander' } });

      expect(await usecase.execute(commandFor('cus_nobody', 'pm_x'))).toBe('unknown_customer');

      const row = await prisma.bidder.findUniqueOrThrow({ where: { email: 'bystander@x.com' } });

      expect(row).toMatchObject({ defaultPaymentMethodId: null, cardBrand: null, tokenVersion: 0 });
    });
  });

  describe('when two different cards race for the same bidder', () => {
    it('saves exactly one and bumps once', async () => {
      await prisma.bidder.create({ data: { email: 'race@x.com', stripeCustomerId: 'cus_race' } });

      let arrived = 0;
      let release: () => void = () => undefined;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      beforeGatewayReturns = async (): Promise<void> => {
        arrived += 1;

        if (arrived === 2) {
          release();
        }

        await barrier;
      };

      const outcomes = await Promise.all([
        usecase.execute(commandFor('cus_race', 'pm_a')),
        usecase.execute(commandFor('cus_race', 'pm_b')),
      ]);

      expect([...outcomes].sort()).toEqual(['ignored_existing_card', 'saved']);
      expect((await prisma.bidder.findUniqueOrThrow({ where: { email: 'race@x.com' } })).tokenVersion).toBe(1);
    });
  });

  describe('when a token was issued before the card was saved', () => {
    it('no longer matches the bidder version afterwards', async () => {
      const bidder = await prisma.bidder.create({ data: { email: 'token@x.com', stripeCustomerId: 'cus_token' } });
      const tokens = new BidderTokenService(new JwtService({ secret: 'integration-secret-integration-secret' }), {
        ttlSeconds: 3600,
      });
      const issued = await tokens.issue(bidder.id as BidderId, bidder.tokenVersion);

      await usecase.execute(commandFor('cus_token', 'pm_token'));

      const verified = await tokens.verify(issued.token);
      const after = await prisma.bidder.findUniqueOrThrow({ where: { id: bidder.id } });

      expect(verified.tokenVersion).not.toBe(after.tokenVersion);
    });
  });
});
