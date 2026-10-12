import type { IanaTimezone } from './iana-timezone';
import { instantAtLocalMidnight } from './zoned-time';

const chicago = 'America/Chicago' as IanaTimezone;
const havana = 'America/Havana' as IanaTimezone;
const auckland = 'Pacific/Auckland' as IanaTimezone;
const utc = 'UTC' as IanaTimezone;

function at(isoDate: string, timezone: IanaTimezone): string {
  return instantAtLocalMidnight(new Date(`${isoDate}T00:00:00Z`), timezone).toISOString();
}

describe('instantAtLocalMidnight', () => {
  describe('when the zone is UTC', () => {
    it('returns the same instant', () => {
      expect(at('2026-10-09', utc)).toBe('2026-10-09T00:00:00.000Z');
    });
  });

  describe('when the zone is behind UTC in daylight time', () => {
    it('adds the daylight offset', () => {
      expect(at('2026-10-27', chicago)).toBe('2026-10-27T05:00:00.000Z');
    });
  });

  describe('when the zone is behind UTC in standard time', () => {
    it('adds the standard offset', () => {
      expect(at('2026-11-03', chicago)).toBe('2026-11-03T06:00:00.000Z');
    });
  });

  describe('when the day is the US fall-back day', () => {
    it('uses the offset in force at midnight', () => {
      expect(at('2026-11-01', chicago)).toBe('2026-11-01T05:00:00.000Z');
    });
  });

  describe('when the day is the US spring-forward day', () => {
    it('uses the offset in force at midnight', () => {
      expect(at('2026-03-08', chicago)).toBe('2026-03-08T06:00:00.000Z');
    });
  });

  describe('when the zone is ahead of UTC', () => {
    it('returns the previous UTC day', () => {
      expect(at('2026-10-09', auckland)).toBe('2026-10-08T11:00:00.000Z');
    });
  });

  describe('when midnight does not exist because of a DST gap', () => {
    it('returns the first valid instant of the day', () => {
      expect(at('2026-03-08', havana)).toBe('2026-03-08T05:00:00.000Z');
    });
  });
});
