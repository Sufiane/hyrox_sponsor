import { InvalidValueError } from './domain-error';
import type { Brand } from './brand';

export type NormalizedEmail = Brand<string, 'NormalizedEmail'>;

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(raw: string): NormalizedEmail {
  const email = raw.trim().toLowerCase();

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new InvalidValueError('email_invalid');
  }

  return email as NormalizedEmail;
}
