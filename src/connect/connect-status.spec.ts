import { connectStatus, type ConnectReadiness } from './connect-status';
import { stripeConnectAccountId } from '../common/stripe-ids';

describe('connectStatus', () => {
  const accountId = stripeConnectAccountId('acct_1');

  function athlete(overrides: Partial<ConnectReadiness>): ConnectReadiness {
    return {
      stripeConnectAccountId: accountId,
      stripeConnectDetailsSubmitted: false,
      stripeConnectPayoutsEnabled: false,
      ...overrides,
    };
  }

  describe('when no account id is stored', () => {
    it('returns NOT_STARTED', () => {
      expect(connectStatus(athlete({ stripeConnectAccountId: null }))).toBe('NOT_STARTED');
    });
  });

  describe('when an account exists but details are not submitted', () => {
    it('returns INCOMPLETE', () => {
      expect(connectStatus(athlete({}))).toBe('INCOMPLETE');
    });
  });

  describe('when details are submitted but payouts are disabled', () => {
    it('returns RESTRICTED', () => {
      expect(connectStatus(athlete({ stripeConnectDetailsSubmitted: true }))).toBe('RESTRICTED');
    });
  });

  describe('when details are submitted and payouts are enabled', () => {
    it('returns READY', () => {
      expect(connectStatus(athlete({ stripeConnectDetailsSubmitted: true, stripeConnectPayoutsEnabled: true }))).toBe(
        'READY',
      );
    });
  });
});
