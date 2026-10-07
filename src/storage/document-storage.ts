import type { DocumentKey } from '../common/document-key';

export abstract class DocumentStorage {
  abstract put(key: DocumentKey, body: Buffer, contentType: string): Promise<void>;
  abstract delete(key: DocumentKey): Promise<void>;
  abstract signedGetUrl(key: DocumentKey, expiresInSeconds: number): Promise<string>;
}
