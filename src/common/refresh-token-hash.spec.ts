import { refreshTokenHash } from './refresh-token-hash';

describe('refreshTokenHash', () => {
  describe('when the value is 64 lowercase hex chars', () => {
    it('returns it', () => {
      const value = 'a'.repeat(64);

      expect(refreshTokenHash(value)).toBe(value);
    });
  });

  describe('when the length is wrong', () => {
    it('throws refresh_token_hash_invalid', () => {
      expect(() => refreshTokenHash('a'.repeat(63))).toThrow('refresh_token_hash_invalid');
    });
  });

  describe('when the value has uppercase chars', () => {
    it('throws refresh_token_hash_invalid', () => {
      expect(() => refreshTokenHash('A'.repeat(64))).toThrow('refresh_token_hash_invalid');
    });
  });

  describe('when the value has non-hex chars', () => {
    it('throws refresh_token_hash_invalid', () => {
      expect(() => refreshTokenHash('g'.repeat(64))).toThrow('refresh_token_hash_invalid');
    });
  });
});
