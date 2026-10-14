const MESSAGES: Record<string, string> = {
  finish_time_out_of_range: 'Finish time must be between 0:30:00 and 6:00:00.',
  seconds_invalid: 'Enter a valid finish time.',
  proof_photo_missing: 'Add a photo of the finish clock.',
  proof_photo_too_large: 'That photo is larger than 10 MB. Choose a smaller one.',
  proof_photo_type_unsupported: 'Photo must be a JPEG, PNG or WebP image.',
  proof_url_invalid: 'That link is not valid. Use a full https:// address.',
  proof_url_host_not_allowed: 'Links from that website are not accepted.',
  race_not_finished: 'This race has not finished yet. You can submit a result after race day.',
  result_state_changed: 'This result changed while you were editing. Reload and try again.',
  validation_failed: 'Check your finish time, photo and link, then try again.',
  not_authenticated: 'Sign in again to continue.',
  athlete_banned: 'This account is suspended.',
  race_entry_not_found: 'We could not find that race entry on your account.',
};

export function resultErrorMessage(code: string, status?: number): string {
  if (status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }

  if (status === 413) {
    return MESSAGES.proof_photo_too_large;
  }

  return MESSAGES[code] ?? 'Something went wrong. Try again.';
}
