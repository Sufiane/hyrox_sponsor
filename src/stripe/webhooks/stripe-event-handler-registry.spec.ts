import { mock } from 'vitest-mock-extended';
import type { StripeEventHandler } from './stripe-event-handler';
import { StripeEventHandlerRegistry } from './stripe-event-handler-registry';

describe('StripeEventHandlerRegistry', () => {
  describe('when no handler is registered', () => {
    it('returns an empty list', () => {
      expect(new StripeEventHandlerRegistry().handlersFor('account.updated')).toEqual([]);
    });
  });

  describe('when handlers are registered', () => {
    it('returns only the handlers that handle the type', () => {
      const matching = mock<StripeEventHandler>();
      const other = mock<StripeEventHandler>();
      matching.handles.mockReturnValue(true);
      other.handles.mockReturnValue(false);
      const registry = new StripeEventHandlerRegistry();

      registry.register(matching);
      registry.register(other);

      expect(registry.handlersFor('account.updated')).toEqual([matching]);
    });
  });

  describe('when the same handler is registered twice', () => {
    it('keeps a single entry', () => {
      const handler = mock<StripeEventHandler>();
      handler.handles.mockReturnValue(true);
      const registry = new StripeEventHandlerRegistry();

      registry.register(handler);
      registry.register(handler);

      expect(registry.handlersFor('account.updated')).toEqual([handler]);
    });
  });
});
