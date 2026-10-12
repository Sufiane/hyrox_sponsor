import type { IanaTimezone } from '../common/iana-timezone';
import { auctionWindow, proofDeadline } from './auction-window';

const chicago = 'America/Chicago' as IanaTimezone;

describe('auctionWindow', () => {
  describe('when no DST change falls inside the window', () => {
    it('opens at local midnight 12 days before the race day', () => {
      const window = auctionWindow(new Date('2026-11-14T00:00:00Z'), chicago);

      expect(window.openAt.toISOString()).toBe('2026-11-02T06:00:00.000Z');
    });

    it('closes at local midnight 5 days before the race day', () => {
      const window = auctionWindow(new Date('2026-11-14T00:00:00Z'), chicago);

      expect(window.closeAt.toISOString()).toBe('2026-11-09T06:00:00.000Z');
    });
  });

  describe('when the DST change falls inside the window', () => {
    it('keeps both boundaries at local midnight', () => {
      const window = auctionWindow(new Date('2026-11-08T00:00:00Z'), chicago);

      expect(window.openAt.toISOString()).toBe('2026-10-27T05:00:00.000Z');
      expect(window.closeAt.toISOString()).toBe('2026-11-03T06:00:00.000Z');
    });
  });

  describe('when the window crosses a month and year boundary', () => {
    it('counts calendar days', () => {
      const window = auctionWindow(new Date('2027-01-04T00:00:00Z'), 'UTC' as IanaTimezone);

      expect(window.openAt.toISOString()).toBe('2026-12-23T00:00:00.000Z');
      expect(window.closeAt.toISOString()).toBe('2026-12-30T00:00:00.000Z');
    });
  });
});

describe('proofDeadline', () => {
  it('is 48 hours after the race start', () => {
    expect(proofDeadline(new Date('2026-11-14T15:00:00Z')).toISOString()).toBe('2026-11-16T15:00:00.000Z');
  });
});
