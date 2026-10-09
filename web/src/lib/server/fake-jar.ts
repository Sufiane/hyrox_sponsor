import type { CookieJar, CookieOptions } from './refresh-cookie.ts';

export interface FakeJar extends CookieJar {
  sets: { name: string; value: string; options: CookieOptions }[];
  deletes: { name: string; options: { path: string } }[];
}

export function createFakeJar(stored?: string): FakeJar {
  const jar: FakeJar = {
    sets: [],
    deletes: [],
    get: () => stored,
    set(name, value, options) {
      jar.sets.push({ name, value, options });
    },
    delete(name, options) {
      jar.deletes.push({ name, options });
    },
  };

  return jar;
}
