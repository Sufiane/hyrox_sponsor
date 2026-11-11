import { connectErrorMessage } from './connect-errors.ts';

describe('connectErrorMessage', () => {
  it.each([
    'athlete_banned',
    'athlete_not_adult',
    'athlete_not_found',
    'connect_account_conflict',
    'stripe_unavailable',
    'stripe_misconfigured',
    'stripe_request_rejected',
    'not_authenticated',
    'invalid_token',
    'request_failed',
    'invalid_onboarding_link',
  ])('has a specific message for %s', (code) => {
    expect(connectErrorMessage(code)).not.toBe(connectErrorMessage('unknown_code'));
  });

  describe('when the code is unknown', () => {
    it('returns the generic message', () => {
      expect(connectErrorMessage('unknown_code')).toBe('Something went wrong. Try again.');
    });
  });

  describe('when the status is 429', () => {
    it('asks to wait regardless of code', () => {
      expect(connectErrorMessage('stripe_unavailable', 429)).toBe('Too many attempts. Wait a minute and try again.');
    });
  });
});
