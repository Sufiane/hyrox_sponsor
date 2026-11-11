import { Injectable } from '@nestjs/common';
import type { StripeEventHandler } from './stripe-event-handler';

@Injectable()
export class StripeEventHandlerRegistry {
  private readonly handlers: StripeEventHandler[] = [];

  register(handler: StripeEventHandler): void {
    if (this.handlers.includes(handler)) {
      return;
    }

    this.handlers.push(handler);
  }

  handlersFor(type: string): readonly StripeEventHandler[] {
    return this.handlers.filter((handler) => handler.handles(type));
  }
}
