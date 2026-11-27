import type { AthleteId, AuctionId, BidderId } from '../common/ids';
import type { NormalizedEmail } from '../common/email';
import type { Cents } from '../common/money';
import type {
  StripeConnectAccountId,
  StripeCustomerId,
  StripePaymentIntentId,
  StripePaymentMethodId,
  StripeSetupIntentId,
} from '../common/stripe-ids';

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

export type CreateCustomerInput = {
  bidderId: BidderId;
  email: NormalizedEmail;
};

export type SetupIntentHandle = {
  id: StripeSetupIntentId;
  clientSecret: string;
};

export type PaymentMethodSnapshot = {
  id: StripePaymentMethodId;
  customerId: StripeCustomerId | null;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type AuthorizeHoldInput = {
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
  amountCents: Cents;
  auctionId: AuctionId;
  bidderId: BidderId;
  attemptId: string;
};

export type HoldAuthorization =
  | { outcome: 'authorized'; paymentIntentId: StripePaymentIntentId; captureBefore: Date | null }
  | { outcome: 'declined'; reason: string }
  | { outcome: 'payment_method_unusable'; reason: string };

export abstract class StripeGateway {
  abstract createExpressAccount(input: CreateExpressAccountInput): Promise<ConnectAccountSnapshot>;
  abstract createOnboardingLink(accountId: StripeConnectAccountId): Promise<OnboardingLink>;
  abstract retrieveAccount(accountId: StripeConnectAccountId): Promise<ConnectAccountSnapshot>;
  abstract createCustomer(input: CreateCustomerInput): Promise<StripeCustomerId>;
  abstract createSetupIntent(customerId: StripeCustomerId): Promise<SetupIntentHandle>;
  abstract retrievePaymentMethod(paymentMethodId: StripePaymentMethodId): Promise<PaymentMethodSnapshot>;
  abstract authorizeHold(input: AuthorizeHoldInput): Promise<HoldAuthorization>;
  abstract cancelHold(paymentIntentId: StripePaymentIntentId): Promise<void>;
  abstract constructWebhookEvent(rawBody: Buffer, signature: string, channel: WebhookChannel): StripeEvent;
}
