import type { StripeEvent } from '../stripe-gateway';

export const STRIPE_EVENT_HANDLERS = Symbol('STRIPE_EVENT_HANDLERS');

export abstract class StripeEventHandler {
  abstract handles(type: string): boolean;
  abstract handle(event: StripeEvent): Promise<void>;
}
