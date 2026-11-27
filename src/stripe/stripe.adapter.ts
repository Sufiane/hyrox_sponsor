import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { InvalidValueError, type DomainError } from '../common/domain-error';
import {
  stripeConnectAccountId,
  stripeCustomerId,
  stripePaymentIntentId,
  stripePaymentMethodId,
  stripeSetupIntentId,
  type StripeConnectAccountId,
  type StripeCustomerId,
  type StripePaymentIntentId,
  type StripePaymentMethodId,
} from '../common/stripe-ids';
import type { EnvironmentVariables } from '../config/env.validation';
import { StripeMisconfiguredError, StripeRejectedError, StripeUnavailableError } from '../common/stripe-errors';
import {
  StripeGateway,
  type AuthorizeHoldInput,
  type ConnectAccountSnapshot,
  type CreateCustomerInput,
  type CreateExpressAccountInput,
  type HoldAuthorization,
  type OnboardingLink,
  type PaymentMethodSnapshot,
  type SetupIntentHandle,
  type StripeEvent,
  type WebhookChannel,
} from './stripe-gateway';

export const STRIPE_API_VERSION = '2026-10-28.endive';
export const PAYOUT_SCHEDULE = { interval: 'daily' } as const;

const MILLIS_PER_SECOND = 1000;
const MAX_NETWORK_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 20_000;
const MISCONFIGURED_ERROR_TYPES: ReadonlySet<string> = new Set(['StripeAuthenticationError', 'StripePermissionError']);
const REJECTED_ERROR_TYPES: ReadonlySet<string> = new Set([
  'StripeCardError',
  'StripeInvalidRequestError',
  'StripeIdempotencyError',
]);
const HOLD_CURRENCY = 'usd';
const UNUSABLE_PAYMENT_METHOD_PARAMS: ReadonlySet<string> = new Set(['payment_method']);

function secondsToDate(epochSeconds: number): Date {
  return new Date(epochSeconds * MILLIS_PER_SECOND);
}

@Injectable()
export class StripeAdapter implements StripeGateway {
  private readonly logger = new Logger(StripeAdapter.name);
  private readonly client: Stripe;
  private readonly webhookSecrets: Record<WebhookChannel, string>;
  private readonly returnUrl: string;
  private readonly refreshUrl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.client = new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true }), {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: MAX_NETWORK_RETRIES,
      timeout: REQUEST_TIMEOUT_MS,
    });
    this.webhookSecrets = {
      platform: config.get('STRIPE_PLATFORM_WEBHOOK_SECRET', { infer: true }),
      connect: config.get('STRIPE_CONNECT_WEBHOOK_SECRET', { infer: true }),
    };
    this.returnUrl = config.get('STRIPE_CONNECT_RETURN_URL', { infer: true });
    this.refreshUrl = config.get('STRIPE_CONNECT_REFRESH_URL', { infer: true });
  }

  async createExpressAccount(input: CreateExpressAccountInput): Promise<ConnectAccountSnapshot> {
    const account = await this.call('createExpressAccount', () =>
      this.client.accounts.create(
        {
          type: 'express',
          country: 'US',
          email: input.email,
          business_type: 'individual',
          capabilities: { transfers: { requested: true } },
          settings: { payouts: { schedule: PAYOUT_SCHEDULE } },
          metadata: { athleteId: input.athleteId },
        },
        { idempotencyKey: `connect-account:${input.athleteId}` },
      ),
    );

    return this.toSnapshot(account);
  }

  async createOnboardingLink(accountId: StripeConnectAccountId): Promise<OnboardingLink> {
    const link = await this.call('createOnboardingLink', () =>
      this.client.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        return_url: this.returnUrl,
        refresh_url: this.refreshUrl,
      }),
    );

    return { url: link.url, expiresAt: secondsToDate(link.expires_at) };
  }

  async retrieveAccount(accountId: StripeConnectAccountId): Promise<ConnectAccountSnapshot> {
    const account = await this.call('retrieveAccount', () => this.client.accounts.retrieve(accountId));

    return this.toSnapshot(account);
  }

  async createCustomer(input: CreateCustomerInput): Promise<StripeCustomerId> {
    const customer = await this.call('createCustomer', () =>
      this.client.customers.create(
        { email: input.email, metadata: { bidderId: input.bidderId } },
        { idempotencyKey: `bidder-customer:${input.bidderId}` },
      ),
    );

    return this.brandReturnedId('customer', customer.id, stripeCustomerId);
  }

  async createSetupIntent(customerId: StripeCustomerId): Promise<SetupIntentHandle> {
    const intent = await this.call('createSetupIntent', () =>
      this.client.setupIntents.create({
        customer: customerId,
        usage: 'off_session',
        allowed_payment_method_types: ['card'],
      }),
    );

    if (intent.client_secret == null) {
      this.logger.error(`Stripe setup intent ${intent.id} has no client secret`);

      throw new StripeUnavailableError();
    }

    return {
      id: this.brandReturnedId('setup intent', intent.id, stripeSetupIntentId),
      clientSecret: intent.client_secret,
    };
  }

  async retrievePaymentMethod(paymentMethodId: StripePaymentMethodId): Promise<PaymentMethodSnapshot> {
    const method = await this.call('retrievePaymentMethod', () => this.client.paymentMethods.retrieve(paymentMethodId));

    if (method.card == null) {
      this.logger.error(`Stripe payment method ${method.id} is not a card (${method.type})`);

      throw new StripeUnavailableError();
    }

    const rawCustomerId = typeof method.customer === 'string' ? method.customer : (method.customer?.id ?? null);

    return {
      id: this.brandReturnedId('payment method', method.id, stripePaymentMethodId),
      customerId: rawCustomerId == null ? null : this.brandReturnedId('customer', rawCustomerId, stripeCustomerId),
      brand: method.card.brand,
      last4: method.card.last4,
      expMonth: method.card.exp_month,
      expYear: method.card.exp_year,
    };
  }

  async authorizeHold(input: AuthorizeHoldInput): Promise<HoldAuthorization> {
    let intent: Stripe.PaymentIntent;

    try {
      intent = await this.client.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: HOLD_CURRENCY,
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          allowed_payment_method_types: ['card'],
          capture_method: 'manual',
          confirm: true,
          off_session: true,
          expand: ['latest_charge'],
          metadata: { auctionId: input.auctionId, bidderId: input.bidderId, attemptId: input.attemptId },
        },
        { idempotencyKey: `bid-hold:${input.attemptId}` },
      );
    } catch (error) {
      return this.holdRefusal(error);
    }

    return this.toHoldAuthorization(intent);
  }

  async cancelHold(paymentIntentId: StripePaymentIntentId): Promise<void> {
    const failure = await this.client.paymentIntents.cancel(paymentIntentId).then(
      () => null,
      (error: unknown) => error,
    );

    if (failure === null) {
      return;
    }

    if (this.errorField(failure, 'code') !== 'payment_intent_unexpected_state') {
      throw this.toDomainError('cancelHold', failure);
    }

    const intent = await this.call('retrievePaymentIntent', () => this.client.paymentIntents.retrieve(paymentIntentId));

    if (intent.status !== 'canceled') {
      this.logger.error(`Stripe hold ${paymentIntentId} cannot be canceled from status ${intent.status}`);

      throw new StripeUnavailableError();
    }
  }

  constructWebhookEvent(rawBody: Buffer, signature: string, channel: WebhookChannel): StripeEvent {
    let event: Stripe.Event;

    try {
      event = this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecrets[channel]);
    } catch (error) {
      this.logger.warn(`Webhook signature verification failed on ${channel}: ${this.describe(error)}`);

      throw new InvalidValueError('stripe_signature_invalid');
    }

    if (channel === 'connect' && event.account == null) {
      this.logger.error(`Connect event ${event.id} (${event.type}) has no account`);

      throw new StripeUnavailableError();
    }

    return {
      id: event.id,
      type: event.type,
      created: secondsToDate(event.created),
      accountId: event.account == null ? null : this.brandReturnedId('account', event.account, stripeConnectAccountId),
      data: event.data.object as unknown as Record<string, unknown>,
    };
  }

  private toSnapshot(account: Stripe.Account): ConnectAccountSnapshot {
    return {
      id: this.brandReturnedId('account', account.id, stripeConnectAccountId),
      detailsSubmitted: account.details_submitted ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      transfersActive: account.capabilities?.transfers === 'active',
      requirementsDue: account.requirements?.currently_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  }

  private brandReturnedId<T>(label: string, raw: string, build: (value: string) => T): T {
    try {
      return build(raw);
    } catch (error) {
      this.logger.error(`Stripe returned a malformed ${label} id: ${this.describe(error)} (${raw})`);

      throw new StripeUnavailableError();
    }
  }

  private async toHoldAuthorization(intent: Stripe.PaymentIntent): Promise<HoldAuthorization> {
    const paymentIntentId = this.brandReturnedId('payment intent', intent.id, stripePaymentIntentId);

    if (intent.status !== 'requires_capture') {
      this.logger.warn(`Stripe hold ${paymentIntentId} ended in status ${intent.status}, canceling it`);
      await this.cancelHold(paymentIntentId).catch((error: unknown) => {
        this.logger.error(
          `Stripe hold ${paymentIntentId} could not be canceled after a decline: ${this.describe(error)}`,
        );
      });

      return { outcome: 'declined', reason: intent.status };
    }

    return { outcome: 'authorized', paymentIntentId, captureBefore: this.captureBefore(intent) };
  }

  private captureBefore(intent: Stripe.PaymentIntent): Date | null {
    const charge = intent.latest_charge;

    if (charge == null || typeof charge === 'string') {
      return null;
    }

    const seconds = charge.payment_method_details?.card?.capture_before;

    return seconds == null ? null : secondsToDate(seconds);
  }

  private holdRefusal(error: unknown): HoldAuthorization {
    const type = this.errorType(error);
    const code = this.errorField(error, 'code');

    if (type === 'StripeCardError') {
      const reason = this.errorField(error, 'decline_code') ?? code ?? 'card_error';

      this.logger.warn(`Stripe declined a hold (${reason}): ${this.describe(error)}`);

      return { outcome: 'declined', reason };
    }

    const param = this.errorField(error, 'param');

    if (type === 'StripeInvalidRequestError' && param != null && UNUSABLE_PAYMENT_METHOD_PARAMS.has(param)) {
      this.logger.warn(`Stripe refused the hold payment method (${code}, ${param}): ${this.describe(error)}`);

      return { outcome: 'payment_method_unusable', reason: code ?? 'invalid_payment_method' };
    }

    throw this.toDomainError('authorizeHold', error);
  }

  private async call<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw this.toDomainError(operation, error);
    }
  }

  private toDomainError(operation: string, error: unknown): DomainError {
    this.logger.error(`Stripe ${operation} failed: ${this.describe(error)}`);

    if (MISCONFIGURED_ERROR_TYPES.has(this.errorType(error))) {
      return new StripeMisconfiguredError();
    }

    if (REJECTED_ERROR_TYPES.has(this.errorType(error))) {
      return new StripeRejectedError();
    }

    return new StripeUnavailableError();
  }

  private errorField(error: unknown, field: 'code' | 'param' | 'decline_code'): string | null {
    if (!(error instanceof Error) || !(field in error)) {
      return null;
    }

    const value: unknown = (error as unknown as Record<string, unknown>)[field];

    return typeof value === 'string' ? value : null;
  }

  private errorType(error: unknown): string {
    if (error instanceof Error && 'type' in error && typeof error.type === 'string') {
      return error.type;
    }

    return 'unknown';
  }

  private describe(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof Error && 'requestId' in error && typeof error.requestId === 'string') {
      return `${message} (request ${error.requestId})`;
    }

    return message;
  }
}
