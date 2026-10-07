import type { DocumentExtension } from './document-key';

export type DetectedDocument = { extension: DocumentExtension; contentType: string };

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER_LENGTH = 12;

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return buffer.subarray(0, signature.length).equals(signature);
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= WEBP_HEADER_LENGTH &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

export function detectDocumentType(buffer: Buffer): DetectedDocument | null {
  if (startsWith(buffer, JPEG_SIGNATURE)) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }

  if (startsWith(buffer, PNG_SIGNATURE)) {
    return { extension: 'png', contentType: 'image/png' };
  }

  if (isWebp(buffer)) {
    return { extension: 'webp', contentType: 'image/webp' };
  }

  if (isPdf(buffer)) {
    return { extension: 'pdf', contentType: 'application/pdf' };
  }

  return null;
}
