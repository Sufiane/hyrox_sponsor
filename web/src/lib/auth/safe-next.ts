const PARSE_ORIGIN = 'http://safe-next.invalid';

export function safeNext(raw: string | null): string {
  if (raw == null || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/';
  }

  if (/\p{Cc}/u.test(raw) || new URL(raw, PARSE_ORIGIN).origin !== PARSE_ORIGIN) {
    return '/';
  }

  return raw;
}
