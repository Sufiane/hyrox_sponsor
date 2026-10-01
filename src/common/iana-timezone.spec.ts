import { ianaTimezone } from './iana-timezone.js';

describe('ianaTimezone', () => {
  describe('when the value is a valid IANA timezone', () => {
    it('returns the value', () => {
      expect(ianaTimezone('America/Chicago')).toBe('America/Chicago');
    });
  });

  describe('when the value is not a timezone', () => {
    it('throws', () => {
      expect(() => ianaTimezone('Mars/Olympus')).toThrow('iana_timezone_invalid');
    });
  });

  describe('when the value is empty', () => {
    it('throws', () => {
      expect(() => ianaTimezone('')).toThrow('iana_timezone_invalid');
    });
  });
});
