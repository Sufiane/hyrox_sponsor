import { InvalidValueError } from '../common/domain-error';
import { PROOF_URL_MAX_LENGTH, parseProofUrl } from './proof-url-policy';

const allowed = ['results.example.com'];

describe('parseProofUrl', () => {
  describe('when the url is https on an allowed host', () => {
    it('returns the trimmed url', () => {
      expect(parseProofUrl('  https://results.example.com/athlete/42  ', allowed)).toBe(
        'https://results.example.com/athlete/42',
      );
    });
  });

  describe('when the host differs only by case', () => {
    it('accepts it', () => {
      expect(parseProofUrl('https://RESULTS.Example.com/x', allowed)).toBe('https://RESULTS.Example.com/x');
    });
  });

  describe('when the url is not a valid https url', () => {
    it.each([
      'http://results.example.com/x',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://results.example.com/x',
      'not a url',
      '//results.example.com/x',
      'https://user:pass@results.example.com/x',
      'https://results.example.com@evil.test/x',
      'https://results.example.com:8443/x',
      `https://results.example.com/${'a'.repeat(PROOF_URL_MAX_LENGTH)}`,
    ])('throws proof_url_invalid for %s', (raw) => {
      expect(() => parseProofUrl(raw, allowed)).toThrow(InvalidValueError);
      expect(() => parseProofUrl(raw, allowed)).toThrow('proof_url_invalid');
    });
  });

  describe('when the host is not on the allowlist', () => {
    it.each(['https://evil.test/x', 'https://sub.results.example.com/x', 'https://example.com/x'])(
      'throws proof_url_host_not_allowed for %s',
      (raw) => {
        expect(() => parseProofUrl(raw, allowed)).toThrow('proof_url_host_not_allowed');
      },
    );
  });

  describe('when the allowlist is empty', () => {
    it('throws proof_url_host_not_allowed', () => {
      expect(() => parseProofUrl('https://results.example.com/x', [])).toThrow('proof_url_host_not_allowed');
    });
  });

  describe('when the explicit default port is given', () => {
    it('accepts it', () => {
      expect(parseProofUrl('https://results.example.com:443/x', allowed)).toBe(
        'https://results.example.com:443/x',
      );
    });
  });
});
