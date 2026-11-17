import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InvalidValueError } from '../common/domain-error';
import { stripeCustomerId, stripePaymentMethodId, stripeSetupIntentId } from '../common/stripe-ids';
import type { StripeEvent } from '../stripe/stripe-gateway';
import { StripeEventHandler } from '../stripe/webhooks/stripe-event-handler';
import { StripeEventHandlerRegistry } from '../stripe/webhooks/stripe-event-handler-registry';
import { BidderService } from './bidder.service';
import type { SyncPaymentMethodCommand } from './usecases/sync-payment-method/sync-payment-method.usecase';

@Injectable()
export class SetupIntentSucceededHandler extends StripeEventHandler implements OnModuleInit {
  private readonly logger = new Logger(SetupIntentSucceededHandler.name);

  constructor(
    private readonly bidders: BidderService,
    private readonly registry: StripeEventHandlerRegistry,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  handles(type: string): boolean {
    return type === 'setup_intent.succeeded';
  }

  async handle(event: StripeEvent): Promise<void> {
    if (event.accountId != null) {
      this.logger.debug(`Webhook ${event.id} (${event.type}) is for a connected account, ignored`);

      return;
    }

    const command = this.parse(event);

    if (!command) {
      return;
    }

    await this.bidders.syncPaymentMethod(command);
  }

  private parse(event: StripeEvent): SyncPaymentMethodCommand | null {
    const { id, customer, payment_method: paymentMethod, payment_method_types: types } = event.data;

    if (!Array.isArray(types) || types.length !== 1 || types[0] !== 'card') {
      this.logger.warn(`Webhook ${event.id}: setup intent is not card-only, ignored`);

      return null;
    }

    if (typeof id !== 'string' || typeof customer !== 'string' || typeof paymentMethod !== 'string') {
      this.logger.warn(`Webhook ${event.id}: setup intent has no customer or payment method id, ignored`);

      return null;
    }

    try {
      return {
        setupIntentId: stripeSetupIntentId(id),
        customerId: stripeCustomerId(customer),
        paymentMethodId: stripePaymentMethodId(paymentMethod),
      };
    } catch (error) {
      if (!(error instanceof InvalidValueError)) {
        throw error;
      }

      this.logger.error(`Webhook ${event.id}: malformed id in setup intent payload (${error.message}), ignored`);

      return null;
    }
  }
}
