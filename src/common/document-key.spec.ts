import { InvalidValueError } from './domain-error';
import { buildDocumentKey, documentKey } from './document-key';
import type { RaceEntryId } from './ids';

describe('documentKey', () => {
  describe('when the value has the expected shape', () => {
    it('returns the key', () => {
      const value = 'race-entries/abc123/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf';

      expect(documentKey(value)).toBe(value);
    });
  });

  describe('when the value is malformed', () => {
    it.each([
      '',
      'race-entries/abc/../x.pdf',
      'other/abc/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf',
      'race-entries/abc/x.exe',
    ])('throws InvalidValueError for %s', (value) => {
      expect(() => documentKey(value)).toThrow(InvalidValueError);
      expect(() => documentKey(value)).toThrow('document_key_invalid');
    });
  });
});

describe('buildDocumentKey', () => {
  it('builds a valid key under the race entry prefix', () => {
    const key = buildDocumentKey('entry1' as RaceEntryId, 'png');

    expect(key.startsWith('race-entries/entry1/')).toBe(true);
    expect(key.endsWith('.png')).toBe(true);
    expect(() => documentKey(key)).not.toThrow();
  });
});
