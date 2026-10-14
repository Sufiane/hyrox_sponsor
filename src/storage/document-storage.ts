import type { DocumentKey } from '../common/document-key';
import type { ResultProofKey } from '../common/result-proof-key';

export type StorageKey = DocumentKey | ResultProofKey;

export abstract class DocumentStorage {
  abstract put(key: StorageKey, body: Buffer, contentType: string): Promise<void>;
  abstract delete(key: StorageKey): Promise<void>;
  abstract signedGetUrl(key: StorageKey, expiresInSeconds: number): Promise<string>;
}
