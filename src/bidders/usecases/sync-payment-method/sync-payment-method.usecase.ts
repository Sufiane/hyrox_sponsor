import { Injectable, Logger } from '@nestjs/common';
import type { StripeCustomerId, StripePaymentMethodId, StripeSetupIntentId } from '../../../common/stripe-ids';
import { StripeGateway } from '../../../stripe/stripe-gateway';
import { SyncPaymentMethodUsecaseDb } from './sync-payment-method.usecase.db';

const LAST4_PATTERN = /^[0-9]{4}$/;

export type SyncPaymentMethodCommand = {
  setupIntentId: StripeSetupIntentId;
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
};

export type SyncPaymentMethodOutcome =
  'saved' | 'already_saved' | 'ignored_existing_card' | 'unknown_customer' | 'invalid_card_data';

@Injectable()
export class SyncPaymentMethodUsecase {
  private readonly logger = new Logger(SyncPaymentMethodUsecase.name);

  constructor(
    private readonly db: SyncPaymentMethodUsecaseDb,
    private readonly gateway: StripeGateway,
  ) {}

  async execute(command: SyncPaymentMethodCommand): Promise<SyncPaymentMethodOutcome> {
    const bidder = await this.db.findByStripeCustomerId(command.customerId);

    if (!bidder) {
      this.logger.warn(`Setup intent ${command.setupIntentId} succeeded for unknown customer ${command.customerId}`);

      return 'unknown_customer';
    }

    if (bidder.defaultPaymentMethodId != null) {
      return this.classifyExisting(bidder.defaultPaymentMethodId, command);
    }

    const card = await this.gateway.retrievePaymentMethod(command.paymentMethodId);

    if (!LAST4_PATTERN.test(card.last4) || card.brand.trim() === '') {
      this.logger.error(`Payment method ${command.paymentMethodId} has unusable card data, not saved`);

      return 'invalid_card_data';
    }

    const saved = await this.db.saveFirstCard({
      customerId: command.customerId,
      paymentMethodId: command.paymentMethodId,
      brand: card.brand,
      last4: card.last4,
    });

    if (saved) {
      this.logger.log(`Saved payment method ${command.paymentMethodId} for bidder ${bidder.id}`);

      return 'saved';
    }

    const current = await this.db.findByStripeCustomerId(command.customerId);

    if (!current) {
      this.logger.warn(`Bidder for customer ${command.customerId} vanished while saving ${command.paymentMethodId}`);

      return 'unknown_customer';
    }

    if (current.defaultPaymentMethodId == null) {
      this.logger.error(
        `Save of payment method ${command.paymentMethodId} matched no row but bidder ${current.id} still has no card`,
      );

      throw new Error('payment_method_save_failed');
    }

    return this.classifyExisting(current.defaultPaymentMethodId, command);
  }

  private classifyExisting(existingId: string, command: SyncPaymentMethodCommand): SyncPaymentMethodOutcome {
    if (existingId === command.paymentMethodId) {
      this.logger.debug(
        `Payment method ${command.paymentMethodId} already saved (setup intent ${command.setupIntentId})`,
      );

      return 'already_saved';
    }

    this.logger.warn(
      `Ignored payment method ${command.paymentMethodId} from setup intent ${command.setupIntentId}: customer ${command.customerId} already has ${existingId}`,
    );

    return 'ignored_existing_card';
  }
}
