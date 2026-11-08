import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type MockInstance } from 'vitest';
import { normalizeEmail } from '../common/email';
import { InvalidValueError } from '../common/domain-error';
import { athleteId } from '../common/ids';
import { stripeConnectAccountId } from '../common/stripe-ids';
import type { EnvironmentVariables } from '../config/env.validation';
import { StripeMisconfiguredError, StripeRejectedError, StripeUnavailableError } from '../common/stripe-errors';
import { PAYOUT_SCHEDULE, STRIPE_API_VERSION, StripeAdapter } from './stripe.adapter';

const mocks = vi.hoisted(() => ({
  constructorArgs: vi.fn(),
  accountsCreate: vi.fn(),
  accountsRetrieve: vi.fn(),
  accountLinksCreate: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class FakeStripe {
    accounts = { create: mocks.accountsCreate, retrieve: mocks.accountsRetrieve };
    accountLinks = { create: mocks.accountLinksCreate };
    webhooks = { constructEvent: mocks.constructEvent };

    constructor(...args: unknown[]) {
      mocks.constructorArgs(...args);
    }
  },
}));

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_secret',
  STRIPE_PLATFORM_WEBHOOK_SECRET: 'whsec_platform',
  STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
  STRIPE_CONNECT_RETURN_URL: 'https://app.example.com/return',
  STRIPE_CONNECT_REFRESH_URL: 'https://app.example.com/refresh',
};

const config = {
  get: (key: string): string => ENV[key],
} as unknown as ConfigService<EnvironmentVariables, true>;

const ATHLETE = athleteId('athlete-1');
const EMAIL = normalizeEmail('Ath@Example.com');

function rawAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acct_123',
    details_submitted: true,
    payouts_enabled: false,
    capabilities: { transfers: 'active' },
    requirements: { currently_due: ['individual.id_number'], disabled_reason: 'requirements.past_due' },
    ...overrides,
  };
}

function stripeFailure(type: string, message = 'raw stripe message'): Error {
  return Object.assign(new Error(message), { type, requestId: 'req_1' });
}

describe('StripeAdapter', () => {
  let adapter: StripeAdapter;
  let logError: MockInstance;
  let logWarn: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    adapter = new StripeAdapter(config);
  });

  afterEach(() => {
    logError.mockRestore();
    logWarn.mockRestore();
  });

  describe('when constructed', () => {
    it('configures the sdk with the pinned api version, retries and timeout', () => {
      expect(mocks.constructorArgs).toHaveBeenCalledWith('sk_test_secret', {
        apiVersion: STRIPE_API_VERSION,
        maxNetworkRetries: 2,
        timeout: 20_000,
      });
    });
  });

  describe('when creating an express account', () => {
    beforeEach(() => {
      mocks.accountsCreate.mockResolvedValue(rawAccount());
    });

    it('sends the express US individual request with the idempotency key', async () => {
      await adapter.createExpressAccount({ athleteId: ATHLETE, email: EMAIL });

      expect(mocks.accountsCreate).toHaveBeenCalledWith(
        {
          type: 'express',
          country: 'US',
          email: 'ath@example.com',
          business_type: 'individual',
          capabilities: { transfers: { requested: true } },
          settings: { payouts: { schedule: PAYOUT_SCHEDULE } },
          metadata: { athleteId: 'athlete-1' },
        },
        { idempotencyKey: 'connect-account:athlete-1' },
      );
    });

    it('returns a branded snapshot', async () => {
      const snapshot = await adapter.createExpressAccount({ athleteId: ATHLETE, email: EMAIL });

      expect(snapshot).toEqual({
        id: stripeConnectAccountId('acct_123'),
        detailsSubmitted: true,
        payoutsEnabled: false,
        transfersActive: true,
        requirementsDue: ['individual.id_number'],
        disabledReason: 'requirements.past_due',
      });
    });
  });

  describe('when creating an onboarding link', () => {
    beforeEach(() => {
      mocks.accountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/x', expires_at: 1_800_000_000 });
    });

    it('sends the account onboarding request with configured urls', async () => {
      await adapter.createOnboardingLink(stripeConnectAccountId('acct_123'));

      expect(mocks.accountLinksCreate).toHaveBeenCalledWith({
        account: 'acct_123',
        type: 'account_onboarding',
        return_url: 'https://app.example.com/return',
        refresh_url: 'https://app.example.com/refresh',
      });
    });

    it('returns the url and expiry as a date', async () => {
      const link = await adapter.createOnboardingLink(stripeConnectAccountId('acct_123'));

      expect(link).toEqual({ url: 'https://connect.stripe.com/x', expiresAt: new Date(1_800_000_000_000) });
    });
  });

  describe('when retrieving an account', () => {
    describe('when the account has no requirements or capabilities', () => {
      beforeEach(() => {
        mocks.accountsRetrieve.mockResolvedValue(
          rawAccount({ capabilities: undefined, requirements: undefined, payouts_enabled: true }),
        );
      });

      it('returns safe defaults', async () => {
        const snapshot = await adapter.retrieveAccount(stripeConnectAccountId('acct_123'));

        expect(snapshot).toEqual({
          id: 'acct_123',
          detailsSubmitted: true,
          payoutsEnabled: true,
          transfersActive: false,
          requirementsDue: [],
          disabledReason: null,
        });
      });
    });

    describe('when stripe returns a malformed account id', () => {
      beforeEach(() => {
        mocks.accountsRetrieve.mockResolvedValue(rawAccount({ id: 'bogus' }));
      });

      it('maps to stripe_unavailable', async () => {
        await expect(adapter.retrieveAccount(stripeConnectAccountId('acct_123'))).rejects.toBeInstanceOf(
          StripeUnavailableError,
        );
      });

      it('logs the detail', async () => {
        await adapter.retrieveAccount(stripeConnectAccountId('acct_123')).catch(() => undefined);

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('stripe_connect_account_id_invalid'));
      });
    });
  });

  describe('when constructing a webhook event', () => {
    const body = Buffer.from('{}');

    beforeEach(() => {
      mocks.constructEvent.mockReturnValue({
        id: 'evt_1',
        type: 'account.updated',
        created: 1_800_000_000,
        account: 'acct_123',
        data: { object: { id: 'acct_123' } },
      });
    });

    describe('when the channel is platform', () => {
      it('verifies with the platform secret', () => {
        adapter.constructWebhookEvent(body, 'sig', 'platform');

        expect(mocks.constructEvent).toHaveBeenCalledWith(body, 'sig', 'whsec_platform');
      });
    });

    describe('when the channel is connect', () => {
      it('verifies with the connect secret', () => {
        adapter.constructWebhookEvent(body, 'sig', 'connect');

        expect(mocks.constructEvent).toHaveBeenCalledWith(body, 'sig', 'whsec_connect');
      });

      it('returns the narrow event', () => {
        expect(adapter.constructWebhookEvent(body, 'sig', 'connect')).toEqual({
          id: 'evt_1',
          type: 'account.updated',
          created: new Date(1_800_000_000_000),
          accountId: 'acct_123',
          data: { id: 'acct_123' },
        });
      });
    });

    describe('when the event has no account', () => {
      beforeEach(() => {
        mocks.constructEvent.mockReturnValue({
          id: 'evt_2',
          type: 'payment_intent.created',
          created: 1_800_000_000,
          data: { object: {} },
        });
      });

      it('returns a null account id', () => {
        expect(adapter.constructWebhookEvent(body, 'sig', 'platform').accountId).toBeNull();
      });
    });

    describe('when the channel is connect and the event has no account', () => {
      beforeEach(() => {
        mocks.constructEvent.mockReturnValue({
          id: 'evt_3',
          type: 'account.updated',
          created: 1_800_000_000,
          data: { object: {} },
        });
      });

      it('maps to stripe_unavailable', () => {
        expect(() => adapter.constructWebhookEvent(body, 'sig', 'connect')).toThrow(StripeUnavailableError);
      });
    });

    describe('when the event carries a malformed account id', () => {
      beforeEach(() => {
        mocks.constructEvent.mockReturnValue({
          id: 'evt_4',
          type: 'account.updated',
          created: 1_800_000_000,
          account: 'bogus',
          data: { object: {} },
        });
      });

      it('maps to stripe_unavailable', () => {
        expect(() => adapter.constructWebhookEvent(body, 'sig', 'connect')).toThrow(StripeUnavailableError);
      });
    });

    describe('when the signature is invalid', () => {
      beforeEach(() => {
        mocks.constructEvent.mockImplementation(() => {
          throw stripeFailure('StripeSignatureVerificationError', 'No signatures found');
        });
      });

      it('throws stripe_signature_invalid', () => {
        expect(() => adapter.constructWebhookEvent(body, 'bad', 'platform')).toThrow(
          expect.objectContaining({ code: 'stripe_signature_invalid' }),
        );
      });

      it('throws a bad-request domain error', () => {
        expect(() => adapter.constructWebhookEvent(body, 'bad', 'platform')).toThrow(InvalidValueError);
      });
    });
  });

  describe.each([
    [
      'createExpressAccount',
      mocks.accountsCreate,
      (adapter: StripeAdapter): Promise<unknown> => adapter.createExpressAccount({ athleteId: ATHLETE, email: EMAIL }),
    ],
    [
      'createOnboardingLink',
      mocks.accountLinksCreate,
      (adapter: StripeAdapter): Promise<unknown> => adapter.createOnboardingLink(stripeConnectAccountId('acct_123')),
    ],
    [
      'retrieveAccount',
      mocks.accountsRetrieve,
      (adapter: StripeAdapter): Promise<unknown> => adapter.retrieveAccount(stripeConnectAccountId('acct_123')),
    ],
  ])('%s error mapping', (_name, sdkMethod, invoke) => {
    describe.each([['StripeConnectionError'], ['StripeAPIError'], ['StripeRateLimitError']])(
      'when stripe fails with %s',
      (type) => {
        beforeEach(() => {
          sdkMethod.mockRejectedValue(stripeFailure(type));
        });

        it('maps to stripe_unavailable', async () => {
          await expect(invoke(adapter)).rejects.toBeInstanceOf(StripeUnavailableError);
        });
      },
    );

    describe.each([['StripeAuthenticationError'], ['StripePermissionError']])('when stripe fails with %s', (type) => {
      beforeEach(() => {
        sdkMethod.mockRejectedValue(stripeFailure(type, 'invalid api key'));
      });

      it('maps to stripe_misconfigured', async () => {
        await expect(invoke(adapter)).rejects.toBeInstanceOf(StripeMisconfiguredError);
      });

      it('logs at error level', async () => {
        await invoke(adapter).catch(() => undefined);

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('invalid api key'));
      });
    });

    describe.each([['StripeCardError'], ['StripeInvalidRequestError'], ['StripeIdempotencyError']])(
      'when stripe fails with %s',
      (type) => {
        beforeEach(() => {
          sdkMethod.mockRejectedValue(stripeFailure(type));
        });

        it('maps to stripe_request_rejected', async () => {
          await expect(invoke(adapter)).rejects.toBeInstanceOf(StripeRejectedError);
        });
      },
    );

    describe('when a non-stripe error is thrown', () => {
      beforeEach(() => {
        sdkMethod.mockRejectedValue(new Error('boom'));
      });

      it('maps to stripe_unavailable', async () => {
        await expect(invoke(adapter)).rejects.toBeInstanceOf(StripeUnavailableError);
      });
    });
  });

  describe('when stripe fails', () => {
    beforeEach(() => {
      mocks.accountLinksCreate.mockRejectedValue(stripeFailure('StripeInvalidRequestError', 'secret detail acct_999'));
    });

    it('keeps the raw message out of the error', async () => {
      const failure = await adapter.createOnboardingLink(stripeConnectAccountId('acct_123')).catch((error) => error);

      expect(failure.message).toBe('stripe_request_rejected');
    });

    it('logs the raw message and request id', async () => {
      await adapter.createOnboardingLink(stripeConnectAccountId('acct_123')).catch(() => undefined);

      expect(logError).toHaveBeenCalledWith(expect.stringContaining('secret detail acct_999'));
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('req_1'));
    });
  });
});
