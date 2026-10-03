import { InvalidValueError } from './domain-error';
import type { Brand } from './brand';

export type TrustScore = Brand<number, 'TrustScore'>;

export function trustScore(value: number): TrustScore {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new InvalidValueError('trust_score_invalid');
  }

  return value as TrustScore;
}
