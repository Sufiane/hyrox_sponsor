import type { Brand } from './brand.js';

export type TrustScore = Brand<number, 'TrustScore'>;

export function trustScore(value: number): TrustScore {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`Trust score must be an integer between 0 and 100, received ${value}`);
  }

  return value as TrustScore;
}
