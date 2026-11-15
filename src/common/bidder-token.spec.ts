import { bidderToken } from './bidder-token';
import { InvalidValueError } from './domain-error';

const validToken = 'aaa.bbb.ccc';

describe('bidderToken', () => {
  describe('when the value is a three-segment base64url token', () => {
    it('returns it trimmed', () => {
      expect(bidderToken(`  ${validToken} `)).toBe(validToken);
    });
  });

  describe.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['two segments', 'aaa.bbb'],
    ['four segments', 'aaa.bbb.ccc.ddd'],
    ['containing a space', 'aaa.bb b.ccc'],
    ['longer than 2048 characters', `${'a'.repeat(2049)}.b.c`],
  ])('when the value is %s', (_name, value) => {
    it('throws bidder_token_invalid', () => {
      expect(() => bidderToken(value)).toThrow(InvalidValueError);
      expect(() => bidderToken(value)).toThrow('bidder_token_invalid');
    });
  });
});
