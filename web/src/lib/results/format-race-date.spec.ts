import { formatRaceDate } from './format-race-date.ts';

describe('formatRaceDate', () => {
  describe('when the race is late evening in its own timezone', () => {
    it('shows the local calendar day', () => {
      expect(formatRaceDate('2026-10-11T21:30:00.000Z', 'America/Los_Angeles')).toBe(
        '11 October 2026',
      );
    });
  });

  describe('when the timezone is ahead of UTC', () => {
    it('shows the local calendar day', () => {
      expect(formatRaceDate('2026-10-10T23:30:00.000Z', 'Europe/Berlin')).toBe('11 October 2026');
    });
  });

  describe('when the timezone is invalid', () => {
    it('falls back to UTC', () => {
      expect(formatRaceDate('2026-10-10T23:30:00.000Z', 'Nope/Nowhere')).toBe('10 October 2026');
    });
  });
});
