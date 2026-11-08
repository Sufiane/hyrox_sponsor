import type { AthleteId } from '../common/ids';
import type { NormalizedEmail } from '../common/email';
import type { StripeConnectAccountId } from '../common/stripe-ids';

export type WebhookChannel = 'platform' | 'connect';

export type ConnectAccountSnapshot = {
  id: StripeConnectAccountId;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  transfersActive: boolean;
  requirementsDue: readonly string[];
  disabledReason: string | null;
};

export type OnboardingLink = {
  url: string;
  expiresAt: Date;
};

export type StripeEvent = {
  id: string;
  type: string;
  created: Date;
  accountId: StripeConnectAccountId | null;
  data: Record<string, unknown>;
};

export type CreateExpressAccountInput = {
  athleteId: AthleteId;
  email: NormalizedEmail;
};

export abstract class StripeGateway {
  abstract createExpressAccount(input: CreateExpressAccountInput): Promise<ConnectAccountSnapshot>;
  abstract createOnboardingLink(accountId: StripeConnectAccountId): Promise<OnboardingLink>;
  abstract retrieveAccount(accountId: StripeConnectAccountId): Promise<ConnectAccountSnapshot>;
  abstract constructWebhookEvent(rawBody: Buffer, signature: string, channel: WebhookChannel): StripeEvent;
}
