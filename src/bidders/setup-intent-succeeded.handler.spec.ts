import { Logger } from '@nestjs/common';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { stripeConnectAccountId } from '../common/stripe-ids';
import type { StripeEvent } from '../stripe/stripe-gateway';
import type { StripeEventHandlerRegistry } from '../stripe/webhooks/stripe-event-handler-registry';
import type { BidderService } from './bidder.service';
import { SetupIntentSucceededHandler } from './setup-intent-succeeded.handler';

function eventWith(data: Record<string, unknown>, accountId: StripeEvent['accountId'] = null): StripeEvent {
  return { id: 'evt_1', type: 'setup_intent.succeeded', created: new Date('2026-11-16T10:00:00Z'), accountId, data };
}

const validData = { id: 'seti_1', customer: 'cus_1', payment_method: 'pm_1', payment_method_types: ['card'] };

describe('SetupIntentSucceededHandler', () => {
  let bidders: MockProxy<BidderService>;
  let registry: MockProxy<StripeEventHandlerRegistry>;
  let handler: SetupIntentSucceededHandler;
  let warnLog: ReturnType<typeof vi.spyOn>;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    bidders = mock<BidderService>();
    registry = mock<StripeEventHandlerRegistry>();
    handler = new SetupIntentSucceededHandler(bidders, registry);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handles', () => {
    it('accepts setup_intent.succeeded only', () => {
      expect(handler.handles('setup_intent.succeeded')).toBe(true);
      expect(handler.handles('setup_intent.setup_failed')).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    it('registers itself', () => {
      handler.onModuleInit();

      expect(registry.register).toHaveBeenCalledWith(handler);
    });
  });

  describe('when the event is valid', () => {
    it('delegates a branded command', async () => {
      await handler.handle(eventWith(validData));

      expect(bidders.syncPaymentMethod).toHaveBeenCalledWith({
        setupIntentId: 'seti_1',
        customerId: 'cus_1',
        paymentMethodId: 'pm_1',
      });
    });

    describe('when the usecase fails', () => {
      it('propagates so the claim is released', async () => {
        bidders.syncPaymentMethod.mockRejectedValue(new Error('stripe_unavailable'));

        await expect(handler.handle(eventWith(validData))).rejects.toThrow('stripe_unavailable');
      });
    });
  });

  describe('when the event belongs to a connected account', () => {
    it('does nothing', async () => {
      await handler.handle(eventWith(validData, stripeConnectAccountId('acct_1')));

      expect(bidders.syncPaymentMethod).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['payment_method_types is not exactly card', { ...validData, payment_method_types: ['card', 'link'] }],
    ['payment_method_types is missing', { ...validData, payment_method_types: undefined }],
    ['customer is null', { ...validData, customer: null }],
    ['customer is missing', { ...validData, customer: undefined }],
    ['customer is an expanded object', { ...validData, customer: { id: 'cus_1' } }],
    ['payment_method is null', { ...validData, payment_method: null }],
    ['payment_method is missing', { ...validData, payment_method: undefined }],
    ['payment_method is an expanded object', { ...validData, payment_method: { id: 'pm_1' } }],
    ['id is missing', { ...validData, id: undefined }],
  ])('when %s', (_label, data) => {
    it('acks without calling the service', async () => {
      await expect(handler.handle(eventWith(data))).resolves.toBeUndefined();
      expect(bidders.syncPaymentMethod).not.toHaveBeenCalled();
    });

    it('logs a warning', async () => {
      await handler.handle(eventWith(data));

      expect(warnLog).toHaveBeenCalledWith(expect.stringContaining('evt_1'));
    });
  });

  describe.each([
    ['id is malformed', { ...validData, id: 'bad' }],
    ['customer id is malformed', { ...validData, customer: 'bad' }],
    ['payment method id is malformed', { ...validData, payment_method: 'bad' }],
  ])('when %s', (_label, data) => {
    it('acks without calling the service', async () => {
      await expect(handler.handle(eventWith(data))).resolves.toBeUndefined();
      expect(bidders.syncPaymentMethod).not.toHaveBeenCalled();
    });

    it('logs an error', async () => {
      await handler.handle(eventWith(data));

      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('evt_1'));
    });
  });
});
