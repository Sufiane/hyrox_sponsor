import { InvalidValueError } from './domain-error';
import { ianaTimezone } from './iana-timezone';

describe('ianaTimezone', () => {
  describe('when the value is a valid IANA timezone', () => {
    it('returns the value', () => {
      expect(ianaTimezone('America/Chicago')).toBe('America/Chicago');
    });
  });

  describe('when the value has non-canonical casing', () => {
    it('returns the canonical casing', () => {
      expect(ianaTimezone('europe/paris')).toBe('Europe/Paris');
      expect(ianaTimezone('AMERICA/CHICAGO')).toBe('America/Chicago');
    });
  });

  describe('when the value is UTC', () => {
    it('keeps UTC', () => {
      expect(ianaTimezone('UTC')).toBe('UTC');
      expect(ianaTimezone('utc')).toBe('UTC');
    });
  });

  describe('when the value is not a timezone', () => {
    it('throws', () => {
      expect(() => ianaTimezone('Mars/Olympus')).toThrow(InvalidValueError);
      expect(() => ianaTimezone('Mars/Olympus')).toThrow('iana_timezone_invalid');
    });
  });

  describe('when the value is empty', () => {
    it('throws', () => {
      expect(() => ianaTimezone('')).toThrow(InvalidValueError);
      expect(() => ianaTimezone('')).toThrow('iana_timezone_invalid');
    });
  });
});
