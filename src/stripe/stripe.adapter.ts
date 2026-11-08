import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { InvalidValueError } from '../common/domain-error';
import { stripeConnectAccountId, type StripeConnectAccountId } from '../common/stripe-ids';
import type { EnvironmentVariables } from '../config/env.validation';
import { StripeMisconfiguredError, StripeRejectedError, StripeUnavailableError } from '../common/stripe-errors';
import {
  StripeGateway,
  type ConnectAccountSnapshot,
  type CreateExpressAccountInput,
  type OnboardingLink,
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
      accountId: event.account == null ? null : this.brandAccountId(event.account),
      data: event.data.object as unknown as Record<string, unknown>,
    };
  }

  private toSnapshot(account: Stripe.Account): ConnectAccountSnapshot {
    return {
      id: this.brandAccountId(account.id),
      detailsSubmitted: account.details_submitted ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      transfersActive: account.capabilities?.transfers === 'active',
      requirementsDue: account.requirements?.currently_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  }

  private brandAccountId(raw: string): StripeConnectAccountId {
    try {
      return stripeConnectAccountId(raw);
    } catch (error) {
      this.logger.error(`Stripe returned a malformed account id: ${this.describe(error)} (${raw})`);

      throw new StripeUnavailableError();
    }
  }

  private async call<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.logger.error(`Stripe ${operation} failed: ${this.describe(error)}`);

      if (MISCONFIGURED_ERROR_TYPES.has(this.errorType(error))) {
        throw new StripeMisconfiguredError();
      }

      if (REJECTED_ERROR_TYPES.has(this.errorType(error))) {
        throw new StripeRejectedError();
      }

      throw new StripeUnavailableError();
    }
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
