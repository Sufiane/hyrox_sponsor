const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  athlete_banned: 'This account is suspended.',
  email_already_registered: 'That email is already registered.',
  adult_attestation_required: 'You must confirm you are 18 or older.',
  validation_failed: 'Check the highlighted fields and try again.',
};

export function authErrorMessage(code: string, status?: number): string {
  if (status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }

  return MESSAGES[code] ?? 'Something went wrong. Try again.';
}
