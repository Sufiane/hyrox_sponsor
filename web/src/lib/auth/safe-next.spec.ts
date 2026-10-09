import { safeNext } from './safe-next.ts';

describe('safeNext', () => {
  describe('when the target is a same-origin path', () => {
    it.each(['/dev/body-map', '/a?b=1', '/'])('keeps %s', (raw) => {
      expect(safeNext(raw)).toBe(raw);
    });
  });

  describe('when the target is unsafe or missing', () => {
    it.each([
      null,
      '',
      '//evil.com',
      'https://evil.com',
      '/\\evil',
      'javascript:x',
      'dev',
      '/\t/evil.com',
      '/\n/evil.com',
      '/a\u0000b',
      '/\u007f',
    ])('falls back to / for %s', (raw) => {
      expect(safeNext(raw)).toBe('/');
    });
  });
});
