import { createBidderTokenStore } from './bidder-token-store.ts';
import type { TokenStorage } from './bidder-token-store.ts';

function fakeStorage(): TokenStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();

  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value): void => {
      data.set(key, value);
    },
    removeItem: (key): void => {
      data.delete(key);
    },
  };
}

describe('createBidderTokenStore', () => {
  const NOW = Date.parse('2026-11-17T12:00:00.000Z');

  describe('when a token has not expired', () => {
    it('returns it', () => {
      const store = createBidderTokenStore(fakeStorage(), () => NOW);

      store.set('a.b.c', '2026-11-18T12:00:00.000Z');

      expect(store.get()).toBe('a.b.c');
    });

    it('is readable by a new store over the same storage', () => {
      const storage = fakeStorage();

      createBidderTokenStore(storage, () => NOW).set('a.b.c', '2026-11-18T12:00:00.000Z');

      expect(createBidderTokenStore(storage, () => NOW).get()).toBe('a.b.c');
    });
  });

  describe('when a token has expired', () => {
    it('returns null and clears storage', () => {
      const storage = fakeStorage();
      const store = createBidderTokenStore(storage, () => NOW);

      store.set('a.b.c', '2026-11-17T11:59:59.000Z');

      expect(store.get()).toBeNull();
      expect(storage.data.size).toBe(0);
    });
  });

  describe('when the expiry is not a date', () => {
    it('does not keep the token', () => {
      const store = createBidderTokenStore(fakeStorage(), () => NOW);

      store.set('a.b.c', 'nonsense');

      expect(store.get()).toBeNull();
    });
  });

  describe('when storage throws', () => {
    it('falls back to memory', () => {
      const throwing: TokenStorage = {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      };
      const store = createBidderTokenStore(throwing, () => NOW);

      store.set('a.b.c', '2026-11-18T12:00:00.000Z');

      expect(store.get()).toBe('a.b.c');
    });
  });

  describe('when there is no storage', () => {
    it('keeps the token in memory', () => {
      const store = createBidderTokenStore(null, () => NOW);

      store.set('a.b.c', '2026-11-18T12:00:00.000Z');

      expect(store.get()).toBe('a.b.c');
    });
  });

  describe('clear', () => {
    it('removes the token', () => {
      const store = createBidderTokenStore(fakeStorage(), () => NOW);

      store.set('a.b.c', '2026-11-18T12:00:00.000Z');
      store.clear();

      expect(store.get()).toBeNull();
    });
  });
});
