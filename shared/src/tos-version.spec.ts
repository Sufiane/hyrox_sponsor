import { TOS_VERSION } from './tos-version.ts';

describe('TOS_VERSION', () => {
  describe('when read', () => {
    it('is a trimmed, non-empty string of at most 64 characters', () => {
      expect(TOS_VERSION).toBe(TOS_VERSION.trim());
      expect(TOS_VERSION.length).toBeGreaterThan(0);
      expect(TOS_VERSION.length).toBeLessThanOrEqual(64);
    });
  });
});
