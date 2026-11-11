const MESSAGES: Record<string, string> = {
  athlete_banned: 'This account is suspended.',
  athlete_not_adult: 'You must be 18 or older to receive payouts.',
  athlete_not_found: 'We could not find your athlete account. Sign in again.',
  connect_account_conflict: 'Your payout account is being set up. Wait a moment and try again.',
  stripe_unavailable: 'Our payment provider is unavailable right now. Try again shortly.',
  stripe_misconfigured: 'Payouts are not available right now. Contact support.',
  stripe_request_rejected: 'Our payment provider rejected the request. Contact support.',
  not_authenticated: 'Sign in again to continue.',
  invalid_token: 'Sign in again to continue.',
  request_failed: 'We could not reach the server. Check your connection and try again.',
  invalid_onboarding_link: 'We received an invalid setup link. Try again or contact support.',
};

export function connectErrorMessage(code: string, status?: number): string {
  if (status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }

  return MESSAGES[code] ?? 'Something went wrong. Try again.';
}
