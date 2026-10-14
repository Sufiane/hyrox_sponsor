import { randomUUID } from 'node:crypto';
import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';
import type { RaceEntryId } from './ids';

export type ResultProofKey = Brand<string, 'ResultProofKey'>;
export type ResultProofExtension = 'jpg' | 'png' | 'webp';

export const RESULT_PROOF_KEY_PATTERN = /^race-results\/[a-z0-9]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function resultProofKey(value: string): ResultProofKey {
  if (!RESULT_PROOF_KEY_PATTERN.test(value)) {
    throw new InvalidValueError('result_proof_key_invalid');
  }

  return value as ResultProofKey;
}

export function buildResultProofKey(
  raceEntryId: RaceEntryId,
  extension: ResultProofExtension,
): ResultProofKey {
  return resultProofKey(`race-results/${raceEntryId}/${randomUUID()}.${extension}`);
}
