export const REFRESH_COOKIE_NAME = 'hyrox_refresh';

const REFRESH_COOKIE_PATH = '/session';

export interface CookieOptions {
  path: string;
  httpOnly: boolean;
  sameSite: 'strict';
  secure: boolean;
  maxAge: number;
}

export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options: CookieOptions): void;
  delete(name: string, options: { path: string }): void;
}

export interface RefreshCookieConfig {
  secure: boolean;
  maxAgeSeconds: number;
}

export function readRefreshToken(jar: CookieJar): string | null {
  const token = jar.get(REFRESH_COOKIE_NAME);

  return token == null || token === '' ? null : token;
}

export function writeRefreshToken(
  jar: CookieJar,
  token: string,
  config: RefreshCookieConfig,
): void {
  jar.set(REFRESH_COOKIE_NAME, token, {
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secure,
    maxAge: config.maxAgeSeconds,
  });
}

export function clearRefreshToken(jar: CookieJar): void {
  jar.delete(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}
