import { randomUUID } from 'node:crypto';
import type { Brand } from './brand';
import { InvalidValueError } from './domain-error';
import type { RaceEntryId } from './ids';

export type DocumentKey = Brand<string, 'DocumentKey'>;
export type DocumentExtension = 'jpg' | 'png' | 'webp' | 'pdf';

export const DOCUMENT_KEY_PATTERN = /^race-entries\/[a-z0-9]+\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export function documentKey(value: string): DocumentKey {
  if (!DOCUMENT_KEY_PATTERN.test(value)) {
    throw new InvalidValueError('document_key_invalid');
  }

  return value as DocumentKey;
}

export function buildDocumentKey(
  raceEntryId: RaceEntryId,
  extension: DocumentExtension,
): DocumentKey {
  return documentKey(`race-entries/${raceEntryId}/${randomUUID()}.${extension}`);
}
