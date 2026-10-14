import { InvalidValueError } from './domain-error';
import type { RaceEntryId } from './ids';
import { buildResultProofKey, resultProofKey } from './result-proof-key';

describe('resultProofKey', () => {
  describe('when the value has the expected shape', () => {
    it.each(['jpg', 'png', 'webp'])('returns the %s key', (extension) => {
      const value = `race-results/abc123/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.${extension}`;

      expect(resultProofKey(value)).toBe(value);
    });
  });

  describe('when the value is malformed', () => {
    it.each([
      '',
      'race-entries/abc123/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.jpg',
      'race-results/abc123/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.pdf',
      'race-results/abc123/not-a-uuid.jpg',
      'race-results/abc/../0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.jpg',
      'race-results/abc123/0b8f6f3e-6a8c-4a6e-9a43-2f3b1d0b9c11.jpg\n',
    ])('throws InvalidValueError for %j', (value) => {
      expect(() => resultProofKey(value)).toThrow(InvalidValueError);
      expect(() => resultProofKey(value)).toThrow('result_proof_key_invalid');
    });
  });
});

describe('buildResultProofKey', () => {
  it('builds a valid key under the race result prefix', () => {
    const key = buildResultProofKey('entry1' as RaceEntryId, 'webp');

    expect(key.startsWith('race-results/entry1/')).toBe(true);
    expect(key.endsWith('.webp')).toBe(true);
    expect(() => resultProofKey(key)).not.toThrow();
  });
});
