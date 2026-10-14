import { render, screen } from '@testing-library/svelte';
import RaceList from './RaceList.svelte';
import type { PublicRaceListItem } from './results-types.ts';

const RACE: PublicRaceListItem = {
  id: 'r 1',
  name: '<script>alert(1)</script> Open',
  location: 'Berlin',
  date: '2026-10-10T08:00:00.000Z',
  timezone: 'Europe/Berlin',
  resultCount: 3,
  verifiedCount: 2,
};

describe('RaceList', () => {
  describe('when there are races', () => {
    it('links each race and shows counts and local date', () => {
      render(RaceList, { races: [RACE], nextCursor: null });

      expect(screen.getByRole('link', { name: /Berlin/ })).toHaveAttribute(
        'href',
        '/results/r%201',
      );
      expect(screen.getByText(/3 results, 2 verified/)).toBeInTheDocument();
      expect(screen.getByText(/10 October 2026/)).toBeInTheDocument();
    });

    it('renders markup in names as text', () => {
      const { container } = render(RaceList, { races: [RACE], nextCursor: null });

      expect(container.querySelector('script')).toBeNull();
      expect(screen.getByText('<script>alert(1)</script> Open')).toBeInTheDocument();
    });
  });

  describe('when there is a next cursor', () => {
    it('links to the next page of races', () => {
      render(RaceList, { races: [RACE], nextCursor: 'a b' });

      expect(screen.getByRole('link', { name: 'Next races' })).toHaveAttribute(
        'href',
        '/results?cursor=a%20b',
      );
    });
  });

  describe('when there is no next cursor', () => {
    it('shows no next link', () => {
      render(RaceList, { races: [RACE], nextCursor: null });

      expect(screen.queryByRole('link', { name: 'Next races' })).not.toBeInTheDocument();
    });
  });

  describe('when there are no races', () => {
    it('shows an empty state', () => {
      render(RaceList, { races: [], nextCursor: null });

      expect(screen.getByText('No race results have been published yet.')).toBeInTheDocument();
    });
  });
});
