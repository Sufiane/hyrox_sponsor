import type { Brand } from './brand';

export type RefreshTokenHash = Brand<string, 'RefreshTokenHash'>;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function refreshTokenHash(raw: string): RefreshTokenHash {
  if (!SHA256_HEX.test(raw)) {
    throw new Error('refresh_token_hash_invalid');
  }

  return raw as RefreshTokenHash;
}
