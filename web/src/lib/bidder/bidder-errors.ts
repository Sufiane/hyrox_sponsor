const MESSAGES: Record<string, string> = {
  email_invalid: 'Enter a valid email address.',
  validation_failed: 'Enter a valid email address.',
  bidder_token_required: 'This email already has a saved card on another device. Use that device to continue.',
  bidder_stripe_customer_conflict: 'Your payment profile is being set up. Wait a moment and try again.',
  stripe_unavailable: 'Our payment provider is unavailable right now. Try again shortly.',
  request_failed: 'We could not reach the server. Check your connection and try again.',
};

export function bidderErrorMessage(code: string, status?: number): string {
  if (status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }

  return MESSAGES[code] ?? 'Something went wrong. Try again.';
}
