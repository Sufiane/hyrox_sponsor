import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';

export type StripePaymentIntentId = Brand<string, 'StripePaymentIntentId'>;
export type StripeCustomerId = Brand<string, 'StripeCustomerId'>;
export type StripeConnectAccountId = Brand<string, 'StripeConnectAccountId'>;

const STRIPE_ID_MAX_LENGTH = 255;

function prefixedStripeId<T extends string>(value: string, prefix: string, code: string): T {
  const trimmed = value.trim();

  if (!trimmed.startsWith(prefix) || trimmed.length === prefix.length || trimmed.length > STRIPE_ID_MAX_LENGTH) {
    throw new InvalidValueError(code);
  }

  return trimmed as T;
}

export function stripeConnectAccountId(value: string): StripeConnectAccountId {
  return prefixedStripeId(value, 'acct_', 'stripe_connect_account_id_invalid');
}

export function stripePaymentIntentId(value: string): StripePaymentIntentId {
  return prefixedStripeId(value, 'pi_', 'stripe_payment_intent_id_invalid');
}

export function stripeCustomerId(value: string): StripeCustomerId {
  return prefixedStripeId(value, 'cus_', 'stripe_customer_id_invalid');
}
