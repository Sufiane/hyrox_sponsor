import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import type { BidderApi } from './bidder-api.ts';
import type { BidderTokenStore } from './bidder-token-store.ts';
import GuestCardCapture from './GuestCardCapture.svelte';
import type { CardElementLike, StripeClient, StripeLoader } from './stripe-loader.ts';

const SETUP = {
  clientSecret: 'seti_secret',
  bidderToken: 'a.b.c',
  bidderTokenExpiresAt: '2026-11-18T00:00:00.000Z',
};

describe('GuestCardCapture', () => {
  let createSetupIntent: Mock<BidderApi['createSetupIntent']>;
  let tokenStore: BidderTokenStore;
  let card: CardElementLike;
  let saveCard: Mock<StripeClient['saveCard']>;
  let stripeLoader: Mock<StripeLoader>;

  async function submitEmail(): Promise<void> {
    await userEvent.type(screen.getByLabelText('Email'), 'guest@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  function renderComponent(): ReturnType<typeof render> {
    return render(GuestCardCapture, { api: { createSetupIntent }, stripeLoader, tokenStore });
  }

  beforeEach(() => {
    createSetupIntent = vi.fn<BidderApi['createSetupIntent']>().mockResolvedValue({ ok: true, value: SETUP });
    tokenStore = { get: vi.fn(() => null), set: vi.fn(), clear: vi.fn() };
    card = { mount: vi.fn(), destroy: vi.fn() };
    saveCard = vi.fn<StripeClient['saveCard']>().mockResolvedValue({ ok: true, brand: 'visa', last4: '4242' });
    stripeLoader = vi.fn<StripeLoader>().mockResolvedValue({ createCardElement: () => card, saveCard });
  });

  describe('when the guest submits an email', () => {
    it('calls the setup endpoint with the email and stored token', async () => {
      vi.mocked(tokenStore.get).mockReturnValue('old.tok.en');
      renderComponent();

      await submitEmail();

      await waitFor(() => expect(createSetupIntent).toHaveBeenCalledWith('guest@example.com', 'old.tok.en'));
    });

    it('stores the returned token', async () => {
      renderComponent();

      await submitEmail();

      await waitFor(() => expect(tokenStore.set).toHaveBeenCalledWith('a.b.c', '2026-11-18T00:00:00.000Z'));
    });

    it('mounts the card element and offers to save', async () => {
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('button', { name: 'Save card' })).toBeInTheDocument();
      expect(card.mount).toHaveBeenCalledWith(screen.getByTestId('card-element'));
    });
  });

  describe('when the card is saved', () => {
    it('shows the brand and last four digits', async () => {
      renderComponent();
      await submitEmail();

      await userEvent.click(await screen.findByRole('button', { name: 'Save card' }));

      expect(await screen.findByText('Card saved: visa ending 4242')).toBeInTheDocument();
      expect(saveCard).toHaveBeenCalledWith(card, 'seti_secret');
    });
  });

  describe('when the card is declined', () => {
    beforeEach(() => {
      saveCard.mockResolvedValue({ ok: false, message: 'Your card was declined.' });
    });

    it('shows the message and offers a retry', async () => {
      renderComponent();
      await submitEmail();

      await userEvent.click(await screen.findByRole('button', { name: 'Save card' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('retry requests a fresh setup intent', async () => {
      renderComponent();
      await submitEmail();
      await userEvent.click(await screen.findByRole('button', { name: 'Save card' }));

      await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

      await waitFor(() => expect(createSetupIntent).toHaveBeenCalledTimes(2));
      expect(card.destroy).toHaveBeenCalled();
    });
  });

  describe('when the API fails', () => {
    beforeEach(() => {
      createSetupIntent.mockResolvedValue({ ok: false, status: 400, code: 'email_invalid' });
    });

    it('shows the mapped message and offers a retry', async () => {
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save card' })).not.toBeInTheDocument();
    });
  });

  describe('when the API throttles', () => {
    it('shows the throttle message', async () => {
      createSetupIntent.mockResolvedValue({ ok: false, status: 429, code: 'throttler_exception' });
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait a minute and try again.');
    });
  });

  describe('when the email is already registered on another device', () => {
    beforeEach(() => {
      createSetupIntent.mockResolvedValue({ ok: false, status: 401, code: 'bidder_token_required' });
    });

    it('shows a terminal message with no retry', async () => {
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('already has a saved card on another device');
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save card' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeEnabled();
    });

    it('lets the guest start over with a different email', async () => {
      renderComponent();
      await submitEmail();
      await screen.findByRole('alert');

      await userEvent.clear(screen.getByLabelText('Email'));
      await userEvent.type(screen.getByLabelText('Email'), 'other@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => expect(createSetupIntent).toHaveBeenLastCalledWith('other@example.com', null));
      expect(createSetupIntent).toHaveBeenCalledTimes(2);
    });
  });

  describe('when no publishable key is configured', () => {
    beforeEach(() => {
      stripeLoader.mockResolvedValue(null);
    });

    it('shows a configuration message and never calls the API', async () => {
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('Card payments are not configured.');
      expect(createSetupIntent).not.toHaveBeenCalled();
    });
  });

  describe('when Stripe.js fails to load', () => {
    it('shows a retryable error', async () => {
      stripeLoader.mockRejectedValue(new Error('stripe_load_failed'));
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('when the component unmounts while the setup request is pending', () => {
    it('creates no card element and stores no token', async () => {
      let resolveSetup: (value: Awaited<ReturnType<BidderApi['createSetupIntent']>>) => void = () => undefined;
      createSetupIntent.mockReturnValue(
        new Promise((resolve) => {
          resolveSetup = resolve;
        }),
      );
      const createCardElement = vi.fn(() => card);
      stripeLoader.mockResolvedValue({ createCardElement, saveCard });
      const { unmount } = renderComponent();
      await submitEmail();
      await waitFor(() => expect(createSetupIntent).toHaveBeenCalled());

      unmount();
      resolveSetup({ ok: true, value: SETUP });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(createCardElement).not.toHaveBeenCalled();
      expect(tokenStore.set).not.toHaveBeenCalled();
    });
  });

  describe('when the component unmounts while the card is mounted', () => {
    it('destroys the card element', async () => {
      const { unmount } = renderComponent();
      await submitEmail();
      await screen.findByRole('button', { name: 'Save card' });

      unmount();

      expect(card.destroy).toHaveBeenCalled();
    });
  });

  describe('when creating the card element throws', () => {
    it('shows a retryable error', async () => {
      stripeLoader.mockResolvedValue({
        createCardElement: () => {
          throw new Error('element_failed');
        },
        saveCard,
      });
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('when saving the card rejects', () => {
    it('shows a retryable error', async () => {
      saveCard.mockRejectedValue(new Error('network'));
      renderComponent();
      await submitEmail();

      await userEvent.click(await screen.findByRole('button', { name: 'Save card' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });
});
