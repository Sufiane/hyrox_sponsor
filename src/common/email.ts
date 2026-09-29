import type { Brand } from './brand.js';

export type NormalizedEmail = Brand<string, 'NormalizedEmail'>;

export function normalizeEmail(raw: string): NormalizedEmail {
  return raw.trim().toLowerCase() as NormalizedEmail;
}
