import { resolveClientIp } from './client-ip.ts';

describe('resolveClientIp', () => {
  describe('when the adapter resolves an address', () => {
    it('returns it', () => {
      expect(resolveClientIp(() => '203.0.113.7')).toBe('203.0.113.7');
    });
  });

  describe('when the adapter throws', () => {
    it('returns null', () => {
      expect(
        resolveClientIp(() => {
          throw new Error('no address');
        }),
      ).toBeNull();
    });
  });

  describe('when the address is empty', () => {
    it('returns null', () => {
      expect(resolveClientIp(() => '  ')).toBeNull();
    });
  });
});
