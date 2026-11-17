import { Logger } from '@nestjs/common';
import type { Bidder } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { StripeCustomerId, StripePaymentMethodId, StripeSetupIntentId } from '../../../common/stripe-ids';
import type { StripeGateway } from '../../../stripe/stripe-gateway';
import { SyncPaymentMethodUsecase, type SyncPaymentMethodCommand } from './sync-payment-method.usecase';
import type { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

describe('SyncPaymentMethodUsecase', () => {
  const command: SyncPaymentMethodCommand = {
    setupIntentId: 'seti_1' as StripeSetupIntentId,
    customerId: 'cus_1' as StripeCustomerId,
    paymentMethodId: 'pm_1' as StripePaymentMethodId,
  };
  let db: DeepMockProxy<SyncPaymentMethodUsecaseDb>;
  let gateway: DeepMockProxy<StripeGateway>;
  let usecase: SyncPaymentMethodUsecase;

  function row(defaultPaymentMethodId: string | null): Bidder {
    return { id: 'bidder-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId } as Bidder;
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    db = mockDeep<SyncPaymentMethodUsecaseDb>();
    gateway = mockDeep<StripeGateway>();
    gateway.retrievePaymentMethod.mockResolvedValue({
      id: command.paymentMethodId,
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
    usecase = new SyncPaymentMethodUsecase(db, gateway);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when no bidder has the customer id', () => {
    beforeEach(() => {
      db.findByStripeCustomerId.mockResolvedValue(null);
    });

    it('reports unknown_customer', async () => {
      expect(await usecase.execute(command)).toBe('unknown_customer');
    });

    it('does not call Stripe or write', async () => {
      await usecase.execute(command);

      expect(gateway.retrievePaymentMethod).not.toHaveBeenCalled();
      expect(db.saveFirstCard).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder already has this card', () => {
    beforeEach(() => {
      db.findByStripeCustomerId.mockResolvedValue(row('pm_1'));
    });

    it('reports already_saved', async () => {
      expect(await usecase.execute(command)).toBe('already_saved');
    });

    it('does not call Stripe or write', async () => {
      await usecase.execute(command);

      expect(gateway.retrievePaymentMethod).not.toHaveBeenCalled();
      expect(db.saveFirstCard).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder already has another card', () => {
    beforeEach(() => {
      db.findByStripeCustomerId.mockResolvedValue(row('pm_other'));
    });

    it('reports ignored_existing_card', async () => {
      expect(await usecase.execute(command)).toBe('ignored_existing_card');
    });

    it('does not call Stripe or write', async () => {
      await usecase.execute(command);

      expect(gateway.retrievePaymentMethod).not.toHaveBeenCalled();
      expect(db.saveFirstCard).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder has no card', () => {
    beforeEach(() => {
      db.findByStripeCustomerId.mockResolvedValue(row(null));
      db.saveFirstCard.mockResolvedValue(true);
    });

    it('saves brand and last4 from the retrieved payment method', async () => {
      await usecase.execute(command);

      expect(gateway.retrievePaymentMethod).toHaveBeenCalledWith(command.paymentMethodId);
      expect(db.saveFirstCard).toHaveBeenCalledWith({
        customerId: command.customerId,
        paymentMethodId: command.paymentMethodId,
        brand: 'visa',
        last4: '4242',
      });
    });

    it('reports saved', async () => {
      expect(await usecase.execute(command)).toBe('saved');
    });

    describe('when Stripe fails', () => {
      it('propagates and writes nothing', async () => {
        gateway.retrievePaymentMethod.mockRejectedValue(new Error('stripe_unavailable'));

        await expect(usecase.execute(command)).rejects.toThrow('stripe_unavailable');
        expect(db.saveFirstCard).not.toHaveBeenCalled();
      });
    });

    describe('when last4 is not four digits', () => {
      beforeEach(() => {
        gateway.retrievePaymentMethod.mockResolvedValue({
          id: command.paymentMethodId,
          brand: 'visa',
          last4: '42',
          expMonth: 12,
          expYear: 2030,
        });
      });

      it('reports invalid_card_data and writes nothing', async () => {
        expect(await usecase.execute(command)).toBe('invalid_card_data');
        expect(db.saveFirstCard).not.toHaveBeenCalled();
      });
    });

    describe('when brand is empty', () => {
      beforeEach(() => {
        gateway.retrievePaymentMethod.mockResolvedValue({
          id: command.paymentMethodId,
          brand: ' ',
          last4: '4242',
          expMonth: 12,
          expYear: 2030,
        });
      });

      it('reports invalid_card_data and writes nothing', async () => {
        expect(await usecase.execute(command)).toBe('invalid_card_data');
        expect(db.saveFirstCard).not.toHaveBeenCalled();
      });
    });

    describe('when another event wins the write', () => {
      beforeEach(() => {
        db.saveFirstCard.mockResolvedValue(false);
      });

      describe('when the winner saved the same card', () => {
        it('reports already_saved', async () => {
          db.findByStripeCustomerId.mockResolvedValueOnce(row(null)).mockResolvedValueOnce(row('pm_1'));

          expect(await usecase.execute(command)).toBe('already_saved');
        });
      });

      describe('when the winner saved another card', () => {
        it('reports ignored_existing_card', async () => {
          db.findByStripeCustomerId.mockResolvedValueOnce(row(null)).mockResolvedValueOnce(row('pm_other'));

          expect(await usecase.execute(command)).toBe('ignored_existing_card');
        });
      });

      describe('when the bidder vanished', () => {
        it('reports unknown_customer', async () => {
          db.findByStripeCustomerId.mockResolvedValueOnce(row(null)).mockResolvedValueOnce(null);

          expect(await usecase.execute(command)).toBe('unknown_customer');
        });
      });

      describe('when the bidder still has no card', () => {
        it('throws so the event is retried', async () => {
          db.findByStripeCustomerId.mockResolvedValueOnce(row(null)).mockResolvedValueOnce(row(null));

          await expect(usecase.execute(command)).rejects.toThrow('payment_method_save_failed');
        });
      });
    });
  });
});
