import type { StripeEvent } from '../stripe-gateway';

export abstract class StripeEventHandler {
  abstract handles(type: string): boolean;
  abstract handle(event: StripeEvent): Promise<void>;
}
