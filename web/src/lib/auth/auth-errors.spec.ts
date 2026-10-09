import { authErrorMessage } from './auth-errors.ts';

describe('authErrorMessage', () => {
  it.each([
    ['invalid_credentials', 'Email or password is incorrect.'],
    ['athlete_banned', 'This account is suspended.'],
    ['email_already_registered', 'That email is already registered.'],
    ['adult_attestation_required', 'You must confirm you are 18 or older.'],
    ['validation_failed', 'Check the highlighted fields and try again.'],
    ['something_else', 'Something went wrong. Try again.'],
  ])('maps %s', (code, message) => {
    expect(authErrorMessage(code)).toBe(message);
  });

  describe('when the status is 429', () => {
    it('asks to wait regardless of code', () => {
      expect(authErrorMessage('invalid_credentials', 429)).toBe(
        'Too many attempts. Wait a minute and try again.',
      );
    });
  });
});
