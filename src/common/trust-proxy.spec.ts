import { applyTrustProxy } from './trust-proxy';

describe('applyTrustProxy', () => {
  describe('when hops is 0', () => {
    it('disables trust proxy', () => {
      const app = { set: vi.fn() };

      applyTrustProxy(app, 0);

      expect(app.set).toHaveBeenCalledWith('trust proxy', false);
    });
  });

  describe('when hops is positive', () => {
    it('sets the numeric hop count', () => {
      const app = { set: vi.fn() };

      applyTrustProxy(app, 2);

      expect(app.set).toHaveBeenCalledWith('trust proxy', 2);
    });
  });
});
