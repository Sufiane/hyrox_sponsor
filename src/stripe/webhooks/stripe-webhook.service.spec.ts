import { InternalServerErrorException, Logger } from '@nestjs/common';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { InvalidValueError } from '../../common/domain-error';
import type { StripeEvent, StripeGateway } from '../stripe-gateway';
import type { StripeEventHandler } from './stripe-event-handler';
import type { StripeWebhookEventDb } from './stripe-webhook-event.db';
import { StripeEventHandlerRegistry } from './stripe-event-handler-registry';
import { StripeWebhookService } from './stripe-webhook.service';

const rawBody = Buffer.from('{"id":"evt_1"}');
const event: StripeEvent = {
  id: 'evt_1',
  type: 'account.updated',
  created: new Date('2026-11-01T09:00:00Z'),
  accountId: null,
  data: {},
};

describe('StripeWebhookService', () => {
  let gateway: MockProxy<StripeGateway>;
  let db: MockProxy<StripeWebhookEventDb>;
  let handler: MockProxy<StripeEventHandler>;
  let debug: ReturnType<typeof vi.spyOn>;

  function build(handlers: readonly StripeEventHandler[]): StripeWebhookService {
    const registry = new StripeEventHandlerRegistry();

    for (const registered of handlers) {
      registry.register(registered);
    }

    return new StripeWebhookService(gateway, db, registry);
  }

  beforeEach(() => {
    gateway = mock<StripeGateway>();
    db = mock<StripeWebhookEventDb>();
    handler = mock<StripeEventHandler>();
    gateway.constructWebhookEvent.mockReturnValue(event);
    handler.handles.mockReturnValue(true);
    handler.handle.mockResolvedValue(undefined);
    db.markProcessed.mockResolvedValue(undefined);
    db.claim.mockResolvedValue(true);
    db.release.mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when the event is valid and new', () => {
    beforeEach(() => {
      db.insertIfNew.mockResolvedValue(true);
    });

    it('verifies on the given channel, records, claims, dispatches and marks processed', async () => {
      await build([handler]).receive({ rawBody, signature: 'sig', channel: 'connect' });

      expect(gateway.constructWebhookEvent).toHaveBeenCalledWith(rawBody, 'sig', 'connect');
      expect(db.insertIfNew).toHaveBeenCalledWith({ id: 'evt_1', type: 'account.updated', channel: 'connect' });
      expect(db.claim).toHaveBeenCalledWith('evt_1', expect.any(Date));
      expect(handler.handle).toHaveBeenCalledWith(event);
      expect(db.markProcessed).toHaveBeenCalledWith('evt_1', expect.any(Date));
    });

    it('does not dispatch to handlers that do not handle the type', async () => {
      handler.handles.mockReturnValue(false);

      await build([handler]).receive({ rawBody, signature: 'sig', channel: 'platform' });

      expect(handler.handle).not.toHaveBeenCalled();
    });
  });

  describe('when no handler matches', () => {
    it('marks the event processed and logs at debug', async () => {
      db.insertIfNew.mockResolvedValue(true);

      await build([]).receive({ rawBody, signature: 'sig', channel: 'platform' });

      expect(db.markProcessed).toHaveBeenCalledWith('evt_1', expect.any(Date));
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('evt_1'));
    });
  });

  describe('when the claim fails because the event is processed or in flight', () => {
    beforeEach(() => {
      db.insertIfNew.mockResolvedValue(false);
      db.claim.mockResolvedValue(false);
    });

    it('does not dispatch or mark processed and resolves', async () => {
      await expect(
        build([handler]).receive({ rawBody, signature: 'sig', channel: 'platform' }),
      ).resolves.toBeUndefined();

      expect(handler.handle).not.toHaveBeenCalled();
      expect(db.markProcessed).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('in flight or done'));
    });
  });

  describe('when a redelivery claims a previously failed event', () => {
    it('dispatches and marks processed', async () => {
      db.insertIfNew.mockResolvedValue(false);

      await build([handler]).receive({ rawBody, signature: 'sig', channel: 'platform' });

      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(db.markProcessed).toHaveBeenCalledWith('evt_1', expect.any(Date));
    });
  });

  describe('when the signature is invalid', () => {
    it('propagates stripe_signature_invalid without recording', async () => {
      gateway.constructWebhookEvent.mockImplementation(() => {
        throw new InvalidValueError('stripe_signature_invalid');
      });

      await expect(build([handler]).receive({ rawBody, signature: 'bad', channel: 'platform' })).rejects.toMatchObject({
        code: 'stripe_signature_invalid',
      });

      expect(db.insertIfNew).not.toHaveBeenCalled();
    });
  });

  describe('when the signature header or raw body is missing', () => {
    it.each([
      ['signature', { rawBody, signature: undefined }],
      ['signature is empty', { rawBody, signature: '' }],
      ['raw body', { rawBody: undefined, signature: 'sig' }],
    ])('rejects with stripe_signature_invalid for missing %s', async (_label, input) => {
      await expect(build([handler]).receive({ ...input, channel: 'platform' })).rejects.toMatchObject({
        code: 'stripe_signature_invalid',
      });

      expect(gateway.constructWebhookEvent).not.toHaveBeenCalled();
      expect(db.insertIfNew).not.toHaveBeenCalled();
    });
  });

  describe('when a handler throws', () => {
    beforeEach(() => {
      db.insertIfNew.mockResolvedValue(true);
      handler.handle.mockRejectedValue(new Error('boom'));
    });

    it('throws a 500 and leaves the row unprocessed', async () => {
      await expect(build([handler]).receive({ rawBody, signature: 'sig', channel: 'platform' })).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(db.markProcessed).not.toHaveBeenCalled();
    });

    it('releases the claim so a retry can re-claim', async () => {
      await expect(build([handler]).receive({ rawBody, signature: 'sig', channel: 'platform' })).rejects.toThrow();

      expect(db.release).toHaveBeenCalledWith('evt_1');
    });

    it('re-dispatches on the next delivery', async () => {
      const service = build([handler]);

      await expect(service.receive({ rawBody, signature: 'sig', channel: 'platform' })).rejects.toThrow();

      db.insertIfNew.mockResolvedValue(false);
      handler.handle.mockResolvedValue(undefined);

      await service.receive({ rawBody, signature: 'sig', channel: 'platform' });

      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(db.markProcessed).toHaveBeenCalledTimes(1);
    });
  });
});
