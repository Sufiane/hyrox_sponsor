import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  createThrowawayDatabase,
  DEFAULT_ADMIN_DATABASE_URL,
  isPostgresReachable,
  type ThrowawayDatabase,
} from '../../testing/throwaway-database';
import type { StripeEvent, StripeGateway } from '../stripe-gateway';
import type { StripeEventHandler } from './stripe-event-handler';
import { StripeEventHandlerRegistry } from './stripe-event-handler-registry';
import { StripeWebhookEventDb } from './stripe-webhook-event.db';
import { StripeWebhookService } from './stripe-webhook.service';

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
const reachable = await isPostgresReachable(adminUrl);
const rawBody = Buffer.from('{}');
const CONCURRENT_DELIVERIES = 8;
const EXPIRED_CLAIM_AGE_MS = 120_000;

function eventWithId(id: string): StripeEvent {
  return { id, type: 'account.updated', created: new Date(), accountId: null, data: {} };
}

describe.skipIf(!reachable)('StripeWebhookService (postgres)', () => {
  let database: ThrowawayDatabase;
  let prisma: PrismaService;
  let db: StripeWebhookEventDb;
  let handle: ReturnType<typeof vi.fn>;
  let service: StripeWebhookService;
  let eventId: string;

  function serviceFor(id: string): StripeWebhookService {
    const gateway = { constructWebhookEvent: (): StripeEvent => eventWithId(id) } as unknown as StripeGateway;
    const handler = { handles: (): boolean => true, handle } as unknown as StripeEventHandler;

    const registry = new StripeEventHandlerRegistry();

    registry.register(handler);

    return new StripeWebhookService(gateway, db, registry);
  }

  beforeAll(async () => {
    database = await createThrowawayDatabase(adminUrl);
    prisma = database.prisma;
    db = new StripeWebhookEventDb(prisma);
  });

  afterAll(async () => {
    await database?.drop();
  });

  beforeEach(() => {
    handle = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when the same event id is inserted concurrently', () => {
    it('stores one row and exactly one insert wins', async () => {
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_DELIVERIES }, () =>
          db.insertIfNew({ id: 'evt_race', type: 'account.updated', channel: 'platform' }),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      await expect(prisma.stripeWebhookEvent.count({ where: { id: 'evt_race' } })).resolves.toBe(1);
    });
  });

  describe('when the same event is delivered concurrently with a slow handler', () => {
    beforeEach(() => {
      service = serviceFor('evt_parallel');
      handle.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
    });

    it('calls the handler exactly once', async () => {
      await Promise.all(
        Array.from({ length: CONCURRENT_DELIVERIES }, () =>
          service.receive({ rawBody, signature: 'sig', channel: 'platform' }),
        ),
      );

      expect(handle).toHaveBeenCalledTimes(1);

      const row = await prisma.stripeWebhookEvent.findUnique({ where: { id: 'evt_parallel' } });

      expect(row?.processedAt).not.toBeNull();
    });
  });

  describe('when the same event is delivered again after processing', () => {
    beforeEach(() => {
      service = serviceFor('evt_dup');
    });

    it('calls the handler once and keeps one processed row', async () => {
      await service.receive({ rawBody, signature: 'sig', channel: 'connect' });
      await service.receive({ rawBody, signature: 'sig', channel: 'connect' });

      expect(handle).toHaveBeenCalledTimes(1);

      const row = await prisma.stripeWebhookEvent.findUnique({ where: { id: 'evt_dup' } });

      expect(row?.channel).toBe('CONNECT');
      expect(row?.processedAt).not.toBeNull();
    });
  });

  describe('when a handler fails and Stripe redelivers right away', () => {
    beforeEach(() => {
      eventId = `evt_retry_${randomUUID()}`;
      service = serviceFor(eventId);
    });

    it('re-dispatches and ends processed', async () => {
      handle.mockRejectedValueOnce(new Error('boom'));

      await expect(service.receive({ rawBody, signature: 'sig', channel: 'platform' })).rejects.toThrow();

      const failed = await prisma.stripeWebhookEvent.findUnique({ where: { id: eventId } });

      expect(failed?.processedAt).toBeNull();
      expect(failed?.claimedAt).toBeNull();

      await service.receive({ rawBody, signature: 'sig', channel: 'platform' });

      const retried = await prisma.stripeWebhookEvent.findUnique({ where: { id: eventId } });

      expect(handle).toHaveBeenCalledTimes(2);
      expect(retried?.processedAt).not.toBeNull();
    });
  });

  describe('when a previous attempt crashed holding the claim', () => {
    beforeEach(async () => {
      eventId = `evt_crash_${randomUUID()}`;
      service = serviceFor(eventId);

      await db.insertIfNew({ id: eventId, type: 'account.updated', channel: 'platform' });
      await db.claim(eventId, new Date(Date.now() - EXPIRED_CLAIM_AGE_MS));
    });

    describe('when redelivered within the lease', () => {
      it('does not re-dispatch', async () => {
        await service.receive({ rawBody, signature: 'sig', channel: 'platform' });

        expect(handle).not.toHaveBeenCalled();
      });
    });

    describe('when redelivered after the lease expired', () => {
      beforeEach(async () => {
        await prisma.stripeWebhookEvent.update({
          where: { id: eventId },
          data: { claimedAt: new Date(Date.now() - EXPIRED_CLAIM_AGE_MS) },
        });
      });

      it('re-claims, re-dispatches and marks processed', async () => {
        await service.receive({ rawBody, signature: 'sig', channel: 'platform' });

        const row = await prisma.stripeWebhookEvent.findUnique({ where: { id: eventId } });

        expect(handle).toHaveBeenCalledTimes(1);
        expect(row?.processedAt).not.toBeNull();
      });
    });
  });
});
