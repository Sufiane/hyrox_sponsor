import { requireReachableInCi } from './throwaway-database';

describe('requireReachableInCi', () => {
  describe('when postgres is reachable', () => {
    describe('and CI is unset', () => {
      it('returns true', () => {
        expect(requireReachableInCi(true, {})).toBe(true);
      });
    });

    describe('and CI is true', () => {
      it('returns true', () => {
        expect(requireReachableInCi(true, { CI: 'true' })).toBe(true);
      });
    });
  });

  describe('when postgres is unreachable', () => {
    describe('and CI is true', () => {
      it('throws postgres_unreachable', () => {
        expect(() => requireReachableInCi(false, { CI: 'true' })).toThrow('postgres_unreachable');
      });
    });

    describe('and CI is "1"', () => {
      it('throws postgres_unreachable', () => {
        expect(() => requireReachableInCi(false, { CI: '1' })).toThrow('postgres_unreachable');
      });
    });

    describe('and CI is unset', () => {
      it('returns false', () => {
        expect(requireReachableInCi(false, {})).toBe(false);
      });
    });

    describe('and CI is "false"', () => {
      it('returns false', () => {
        expect(requireReachableInCi(false, { CI: 'false' })).toBe(false);
      });
    });

    describe('and CI is empty', () => {
      it('returns false', () => {
        expect(requireReachableInCi(false, { CI: '' })).toBe(false);
      });
    });
  });
});
