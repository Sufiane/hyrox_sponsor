import { localDateInTimezone } from './local-date';
import { ianaTimezone } from './iana-timezone';

describe('localDateInTimezone', () => {
  const chicago = ianaTimezone('America/Chicago');
  const auckland = ianaTimezone('Pacific/Auckland');

  describe('when the UTC instant is already the next day in UTC but still the previous day locally', () => {
    it('returns the local calendar date', () => {
      const result = localDateInTimezone(new Date('2026-11-15T03:30:00Z'), chicago);

      expect(result.toISOString()).toBe('2026-11-14T00:00:00.000Z');
    });
  });

  describe('when the instant is just before local midnight', () => {
    it('stays on the local day', () => {
      const result = localDateInTimezone(new Date('2026-11-14T23:59:00-06:00'), chicago);

      expect(result.toISOString()).toBe('2026-11-14T00:00:00.000Z');
    });
  });

  describe('when the instant is just after local midnight', () => {
    it('moves to the next local day', () => {
      const result = localDateInTimezone(new Date('2026-11-15T00:01:00-06:00'), chicago);

      expect(result.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    });
  });

  describe('when the zone is ahead of UTC', () => {
    it('returns the later local date', () => {
      const result = localDateInTimezone(new Date('2026-11-14T12:30:00Z'), auckland);

      expect(result.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    });
  });

  describe('when the instant falls on a spring-forward day', () => {
    it('returns that local date', () => {
      const result = localDateInTimezone(new Date('2026-03-08T08:30:00Z'), chicago);

      expect(result.toISOString()).toBe('2026-03-08T00:00:00.000Z');
    });
  });

  describe('when the instant falls on a fall-back day', () => {
    it('returns that local date', () => {
      const result = localDateInTimezone(new Date('2026-11-01T06:30:00Z'), chicago);

      expect(result.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    });
  });
});
