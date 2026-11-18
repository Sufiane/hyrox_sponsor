import { loadStripe } from '@stripe/stripe-js';
import type { Stripe, StripeCardElement } from '@stripe/stripe-js';

export interface CardElementLike {
  mount(target: HTMLElement): void;
  destroy(): void;
}

export type CardSaveResult = { ok: true; brand: string; last4: string } | { ok: false; message: string };

export interface StripeClient {
  createCardElement(): CardElementLike;
  saveCard(card: CardElementLike, clientSecret: string): Promise<CardSaveResult>;
}

export type StripeLoader = () => Promise<StripeClient | null>;

const FALLBACK_MESSAGE = 'We could not save this card. Check the details and try again.';

function wrap(stripe: Stripe): StripeClient {
  return {
    createCardElement(): CardElementLike {
      return stripe.elements().create('card');
    },

    async saveCard(card: CardElementLike, clientSecret: string): Promise<CardSaveResult> {
      const created = await stripe.createPaymentMethod({ type: 'card', card: card as StripeCardElement });

      if (created.error != null || created.paymentMethod.card == null) {
        return { ok: false, message: created.error?.message ?? FALLBACK_MESSAGE };
      }

      const confirmed = await stripe.confirmCardSetup(clientSecret, { payment_method: created.paymentMethod.id });

      if (confirmed.error != null) {
        return { ok: false, message: confirmed.error.message ?? FALLBACK_MESSAGE };
      }

      return { ok: true, brand: created.paymentMethod.card.brand, last4: created.paymentMethod.card.last4 };
    },
  };
}

async function loadClient(publishableKey: string): Promise<StripeClient> {
  const stripe = await loadStripe(publishableKey);

  if (stripe == null) {
    throw new Error('stripe_load_failed');
  }

  return wrap(stripe);
}

export function createStripeLoader(publishableKey: string | undefined): StripeLoader {
  let pending: Promise<StripeClient> | null = null;

  return async (): Promise<StripeClient | null> => {
    if (publishableKey == null || publishableKey === '') {
      return null;
    }

    pending ??= loadClient(publishableKey).catch((error: unknown): never => {
      pending = null;

      throw error;
    });

    return pending;
  };
}
