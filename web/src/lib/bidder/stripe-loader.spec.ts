import { loadStripe } from '@stripe/stripe-js';
import { createStripeLoader } from './stripe-loader.ts';
import type { CardElementLike } from './stripe-loader.ts';

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));

describe('createStripeLoader', () => {
  const cardElement = { mount: vi.fn(), destroy: vi.fn() };
  const elements = { create: vi.fn(() => cardElement) };
  const stripe = {
    elements: vi.fn(() => elements),
    createPaymentMethod: vi.fn(),
    confirmCardSetup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadStripe).mockResolvedValue(stripe as never);
    stripe.elements.mockReturnValue(elements);
    elements.create.mockReturnValue(cardElement);
  });

  describe('when there is no publishable key', () => {
    it('resolves null without loading Stripe', async () => {
      await expect(createStripeLoader(undefined)()).resolves.toBeNull();
      expect(loadStripe).not.toHaveBeenCalled();
    });
  });

  describe('when Stripe.js fails to load', () => {
    it('rejects', async () => {
      vi.mocked(loadStripe).mockResolvedValue(null);

      await expect(createStripeLoader('pk_test_1')()).rejects.toThrow('stripe_load_failed');
    });
  });

  describe('when a previous load failed', () => {
    it('loads again', async () => {
      vi.mocked(loadStripe).mockResolvedValueOnce(null);
      const loader = createStripeLoader('pk_test_1');

      await expect(loader()).rejects.toThrow('stripe_load_failed');
      await expect(loader()).resolves.not.toBeNull();

      expect(loadStripe).toHaveBeenCalledTimes(2);
    });
  });

  describe('when Stripe.js loads', () => {
    it('loads once for repeated calls', async () => {
      const loader = createStripeLoader('pk_test_1');

      await loader();
      await loader();

      expect(loadStripe).toHaveBeenCalledTimes(1);
      expect(loadStripe).toHaveBeenCalledWith('pk_test_1');
    });

    it('creates a card element', async () => {
      const client = await createStripeLoader('pk_test_1')();

      expect(client?.createCardElement()).toBe(cardElement);
      expect(elements.create).toHaveBeenCalledWith('card');
    });
  });

  describe('saveCard', () => {
    let card: CardElementLike;

    beforeEach(() => {
      card = cardElement;
    });

    describe('when the card is accepted', () => {
      it('creates the payment method then confirms the setup', async () => {
        stripe.createPaymentMethod.mockResolvedValue({
          paymentMethod: { id: 'pm_1', card: { brand: 'visa', last4: '4242' } },
        });
        stripe.confirmCardSetup.mockResolvedValue({ setupIntent: { id: 'seti_1' } });
        const client = await createStripeLoader('pk_test_1')();

        const result = await client?.saveCard(card, 'seti_secret');

        expect(stripe.createPaymentMethod).toHaveBeenCalledWith({ type: 'card', card: cardElement });
        expect(stripe.confirmCardSetup).toHaveBeenCalledWith('seti_secret', { payment_method: 'pm_1' });
        expect(result).toEqual({ ok: true, brand: 'visa', last4: '4242' });
      });
    });

    describe('when creating the payment method fails', () => {
      it('returns the Stripe message', async () => {
        stripe.createPaymentMethod.mockResolvedValue({ error: { message: 'Your card number is incomplete.' } });
        const client = await createStripeLoader('pk_test_1')();

        await expect(client?.saveCard(card, 'seti_secret')).resolves.toEqual({
          ok: false,
          message: 'Your card number is incomplete.',
        });
        expect(stripe.confirmCardSetup).not.toHaveBeenCalled();
      });
    });

    describe('when the confirmation is declined', () => {
      it('returns the Stripe message', async () => {
        stripe.createPaymentMethod.mockResolvedValue({
          paymentMethod: { id: 'pm_1', card: { brand: 'visa', last4: '0002' } },
        });
        stripe.confirmCardSetup.mockResolvedValue({ error: { message: 'Your card was declined.' } });
        const client = await createStripeLoader('pk_test_1')();

        await expect(client?.saveCard(card, 'seti_secret')).resolves.toEqual({
          ok: false,
          message: 'Your card was declined.',
        });
      });
    });
  });
});
