export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface BidderTokenStore {
  get(): string | null;
  set(token: string, expiresAt: string): void;
  clear(): void;
}

interface StoredToken {
  token: string;
  expiresAtMs: number;
}

const STORAGE_KEY = 'bidder-token';

function parseStored(raw: string | null): StoredToken | null {
  if (raw == null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredToken>;

    if (typeof parsed.token === 'string' && typeof parsed.expiresAtMs === 'number') {
      return { token: parsed.token, expiresAtMs: parsed.expiresAtMs };
    }
  } catch {
    return null;
  }

  return null;
}

function readStorage(storage: TokenStorage | null): StoredToken | null {
  try {
    return parseStored(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

function wipeStorage(storage: TokenStorage | null): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

function writeStorage(storage: TokenStorage | null, stored: StoredToken): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    return;
  }
}

export function createBidderTokenStore(storage: TokenStorage | null, now: () => number): BidderTokenStore {
  let memory: StoredToken | null = null;

  const clear = (): void => {
    memory = null;
    wipeStorage(storage);
  };

  return {
    get(): string | null {
      const current = memory ?? readStorage(storage);

      if (current == null) {
        return null;
      }

      if (current.expiresAtMs <= now()) {
        clear();

        return null;
      }

      memory = current;

      return current.token;
    },

    set(token: string, expiresAt: string): void {
      const expiresAtMs = Date.parse(expiresAt);

      if (Number.isNaN(expiresAtMs)) {
        clear();

        return;
      }

      memory = { token, expiresAtMs };
      writeStorage(storage, memory);
    },

    clear,
  };
}
