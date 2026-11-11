import { Logger } from '@nestjs/common';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { stripeConnectAccountId } from '../common/stripe-ids';
import type { StripeEvent } from '../stripe/stripe-gateway';
import type { StripeEventHandlerRegistry } from '../stripe/webhooks/stripe-event-handler-registry';
import { ConnectAccountUpdatedHandler } from './connect-account-updated.handler';
import type { ConnectService } from './connect.service';

const accountId = stripeConnectAccountId('acct_1');
const event: StripeEvent = {
  id: 'evt_1',
  type: 'account.updated',
  created: new Date('2026-11-01T09:00:00Z'),
  accountId,
  data: {},
};

describe('ConnectAccountUpdatedHandler', () => {
  let connect: MockProxy<ConnectService>;
  let registry: MockProxy<StripeEventHandlerRegistry>;
  let debug: ReturnType<typeof vi.spyOn>;
  let handler: ConnectAccountUpdatedHandler;

  beforeEach(() => {
    connect = mock<ConnectService>();
    registry = mock<StripeEventHandlerRegistry>();
    debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    handler = new ConnectAccountUpdatedHandler(connect, registry);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handles', () => {
    it('accepts account.updated only', () => {
      expect(handler.handles('account.updated')).toBe(true);
      expect(handler.handles('payment_intent.succeeded')).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    it('registers itself in the registry', () => {
      handler.onModuleInit();

      expect(registry.register).toHaveBeenCalledWith(handler);
    });
  });

  describe('when the event carries an account id', () => {
    it('syncs readiness for that account', async () => {
      connect.syncReadiness.mockResolvedValue(undefined);

      await handler.handle(event);

      expect(connect.syncReadiness).toHaveBeenCalledWith(accountId);
    });
  });

  describe('when the sync fails', () => {
    it('propagates the error', async () => {
      connect.syncReadiness.mockRejectedValue(new Error('stripe down'));

      await expect(handler.handle(event)).rejects.toThrow('stripe down');
    });
  });

  describe('when the event carries no account id', () => {
    it('logs at debug and resolves without syncing', async () => {
      await expect(handler.handle({ ...event, accountId: null })).resolves.toBeUndefined();

      expect(debug).toHaveBeenCalledWith(expect.stringContaining('evt_1'));
      expect(connect.syncReadiness).not.toHaveBeenCalled();
    });
  });
});
