import { InvalidValueError } from './domain-error';
import type { Brand } from './brand';

export type PasswordHash = Brand<string, 'PasswordHash'>;

export function passwordHash(raw: string): PasswordHash {
  if (!raw.startsWith('$argon2id$')) {
    throw new InvalidValueError('password_hash_invalid');
  }

  return raw as PasswordHash;
}
