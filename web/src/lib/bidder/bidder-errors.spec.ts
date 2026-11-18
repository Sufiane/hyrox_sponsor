import { bidderErrorMessage } from './bidder-errors.ts';

describe('bidderErrorMessage', () => {
  describe.each([
    ['email_invalid', 'Enter a valid email address.'],
    ['bidder_token_required', 'This email already has a saved card on another device. Use that device to continue.'],
    ['bidder_stripe_customer_conflict', 'Your payment profile is being set up. Wait a moment and try again.'],
    ['request_failed', 'We could not reach the server. Check your connection and try again.'],
  ])('when the code is %s', (code, expected) => {
    it('returns its message', () => {
      expect(bidderErrorMessage(code)).toBe(expected);
    });
  });

  describe('when the status is 429', () => {
    it('returns the throttle message', () => {
      expect(bidderErrorMessage('throttler_exception', 429)).toBe('Too many attempts. Wait a minute and try again.');
    });
  });

  describe('when the code is unknown', () => {
    it('returns the generic message', () => {
      expect(bidderErrorMessage('boom')).toBe('Something went wrong. Try again.');
    });
  });
});
