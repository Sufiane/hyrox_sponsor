import { detectDocumentType } from './document-sniffer';

const webp = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);

describe('detectDocumentType', () => {
  describe('when the buffer has a supported signature', () => {
    it.each([
      ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), 'jpg', 'image/jpeg'],
      [
        'png',
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
        'png',
        'image/png',
      ],
      ['webp', webp, 'webp', 'image/webp'],
      ['pdf', Buffer.from('%PDF-1.7'), 'pdf', 'application/pdf'],
    ])('detects %s', (_name, buffer, extension, contentType) => {
      expect(detectDocumentType(buffer)).toEqual({ extension, contentType });
    });
  });

  describe('when the buffer has no supported signature', () => {
    it.each([
      ['an executable', Buffer.from('MZ\x90\x00')],
      ['an empty buffer', Buffer.alloc(0)],
      ['a 3-byte buffer', Buffer.from([0x00, 0x01, 0x02])],
      ['a RIFF container that is not WebP', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])],
    ])('returns null for %s', (_name, buffer) => {
      expect(detectDocumentType(buffer)).toBeNull();
    });
  });
});
