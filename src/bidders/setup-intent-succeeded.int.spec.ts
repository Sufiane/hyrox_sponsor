import { Logger } from '@nestjs/common';
import { stripeConnectAccountId, stripeCustomerId, stripePaymentMethodId } from '../common/stripe-ids';
import type { PrismaService } from '../prisma/prisma.service';
import type { StripeEvent, StripeGateway } from '../stripe/stripe-gateway';
import { StripeEventHandlerRegistry } from '../stripe/webhooks/stripe-event-handler-registry';
import { StripeWebhookEventDb } from '../stripe/webhooks/stripe-webhook-event.db';
import { StripeWebhookService } from '../stripe/webhooks/stripe-webhook.service';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  requireReachableInCi,
  type ThrowawayDatabase,
} from '../testing/throwaway-database';
import { BidderDb } from './bidder.db';
import { BidderService } from './bidder.service';
import { SetupIntentSucceededHandler } from './setup-intent-succeeded.handler';
import { SyncPaymentMethodUsecase } from './usecases/sync-payment-method/sync-payment-method.usecase';
import { SyncPaymentMethodUsecaseDb } from './usecases/sync-payment-method/sync-payment-method.usecase.db';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = requireReachableInCi(await isPostgresReachable(adminUrl), process.env);
const rawBody = Buffer.from('{}');

function customerOwning(paymentMethodId: string): string {
  return paymentMethodId.replace(/^pm_/, 'cus_');
}

function setupIntentEvent(id: string, customer: string, paymentMethod: string): StripeEvent {
  return {
    id,
    type: 'setup_intent.succeeded',
    created: new Date(),
    accountId: null,
    data: { id: 'seti_1', customer, payment_method: paymentMethod, payment_method_types: ['card'] },
  };
}

describe.skipIf(!reachable)('setup_intent.succeeded webhook (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let retrievePaymentMethod: ReturnType<typeof vi.fn>;

  function serviceFor(event: StripeEvent): StripeWebhookService {
    const gateway = {
      constructWebhookEvent: (): StripeEvent => event,
      retrievePaymentMethod,
    } as unknown as StripeGateway;
    const usecase = new SyncPaymentMethodUsecase(new SyncPaymentMethodUsecaseDb(prisma), gateway);
    const bidders = new BidderService(new BidderDb(prisma), {} as never, usecase);
    const registry = new StripeEventHandlerRegistry();

    new SetupIntentSucceededHandler(bidders, registry).onModuleInit();

    return new StripeWebhookService(gateway, new StripeWebhookEventDb(prisma), registry);
  }

  function deliver(event: StripeEvent): Promise<void> {
    return serviceFor(event).receive({ rawBody, signature: 'sig', channel: 'platform' });
  }

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
  });

  afterAll(async () => {
    await database?.drop();
  });

  beforeEach(() => {
    retrievePaymentMethod = vi.fn().mockImplementation(async (id: string) => ({
      id: stripePaymentMethodId(id),
      customerId: stripeCustomerId(customerOwning(id)),
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    }));
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when a valid event is delivered twice with the same event id', () => {
    it('saves the card once and marks the event processed', async () => {
      await prisma.bidder.create({ data: { email: 'dup@x.com', stripeCustomerId: 'cus_dup' } });

      await deliver(setupIntentEvent('evt_si_dup', 'cus_dup', 'pm_dup'));
      await deliver(setupIntentEvent('evt_si_dup', 'cus_dup', 'pm_dup'));

      const bidder = await prisma.bidder.findUniqueOrThrow({ where: { email: 'dup@x.com' } });
      const row = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id: 'evt_si_dup' } });

      expect(bidder).toMatchObject({ defaultPaymentMethodId: 'pm_dup', cardLast4: '4242', tokenVersion: 1 });
      expect(row.processedAt).not.toBeNull();
      expect(retrievePaymentMethod).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the same card arrives under a new event id', () => {
    it('keeps the token version at 1', async () => {
      await prisma.bidder.create({ data: { email: 'redeliver@x.com', stripeCustomerId: 'cus_redeliver' } });

      await deliver(setupIntentEvent('evt_si_first', 'cus_redeliver', 'pm_redeliver'));
      await deliver(setupIntentEvent('evt_si_second', 'cus_redeliver', 'pm_redeliver'));

      const bidder = await prisma.bidder.findUniqueOrThrow({ where: { email: 'redeliver@x.com' } });

      expect(bidder.tokenVersion).toBe(1);
    });
  });

  describe('when the payment method belongs to another customer', () => {
    it('acks the event and saves nothing', async () => {
      await prisma.bidder.create({ data: { email: 'victim@x.com', stripeCustomerId: 'cus_victim' } });

      await deliver(setupIntentEvent('evt_si_foreign', 'cus_victim', 'pm_attacker'));

      const bidder = await prisma.bidder.findUniqueOrThrow({ where: { email: 'victim@x.com' } });
      const row = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id: 'evt_si_foreign' } });

      expect(bidder.defaultPaymentMethodId).toBeNull();
      expect(row.processedAt).not.toBeNull();
    });
  });

  describe('when the event belongs to a connected account', () => {
    it('marks it processed without writing or calling Stripe', async () => {
      await prisma.bidder.create({ data: { email: 'connect@x.com', stripeCustomerId: 'cus_connect' } });
      const event = {
        ...setupIntentEvent('evt_si_connect', 'cus_connect', 'pm_connect'),
        accountId: stripeConnectAccountId('acct_1'),
      };

      await deliver(event);

      const bidder = await prisma.bidder.findUniqueOrThrow({ where: { email: 'connect@x.com' } });
      const row = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id: 'evt_si_connect' } });

      expect(bidder.defaultPaymentMethodId).toBeNull();
      expect(row.processedAt).not.toBeNull();
      expect(retrievePaymentMethod).not.toHaveBeenCalled();
    });
  });

  describe('when Stripe is unavailable on the first delivery', () => {
    it('releases the claim, then saves the card on retry', async () => {
      await prisma.bidder.create({ data: { email: 'retry@x.com', stripeCustomerId: 'cus_retry' } });
      const event = setupIntentEvent('evt_si_retry', 'cus_retry', 'pm_retry');

      retrievePaymentMethod.mockRejectedValueOnce(new Error('stripe_unavailable'));

      await expect(deliver(event)).rejects.toThrow('stripe_webhook_handler_failed');

      const failed = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id: 'evt_si_retry' } });

      expect(failed.claimedAt).toBeNull();
      expect(failed.processedAt).toBeNull();
      expect(
        (await prisma.bidder.findUniqueOrThrow({ where: { email: 'retry@x.com' } })).defaultPaymentMethodId,
      ).toBeNull();

      await deliver(event);

      const saved = await prisma.bidder.findUniqueOrThrow({ where: { email: 'retry@x.com' } });

      expect(saved.defaultPaymentMethodId).toBe('pm_retry');
    });
  });
});
