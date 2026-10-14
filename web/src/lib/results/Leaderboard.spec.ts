import { render, screen, within } from '@testing-library/svelte';
import Leaderboard from './Leaderboard.svelte';
import type { PublicResultItem } from './results-types.ts';

const VERIFIED: PublicResultItem = {
  rank: 1,
  displayName: 'Ana B.',
  finishTimeSeconds: 3_725,
  verified: true,
};
const UNVERIFIED: PublicResultItem = {
  rank: null,
  displayName: 'Cy D.',
  finishTimeSeconds: 3_000,
  verified: false,
};

function renderBoard(
  items: PublicResultItem[],
  extra: { total?: number; page?: number } = {},
): ReturnType<typeof render> {
  return render(Leaderboard, {
    items,
    total: extra.total ?? items.length,
    page: extra.page ?? 1,
    pageSize: 50,
    caption: 'Singles Open Men',
    hrefForPage: (page: number) => `?division=X&page=${page}`,
  });
}

describe('Leaderboard', () => {
  describe('when a row is verified', () => {
    it('shows rank, name, time and a Verified tick label', () => {
      renderBoard([VERIFIED]);

      const row = screen.getByRole('row', { name: /Ana B\./ });

      expect(within(row).getByText('1')).toBeInTheDocument();
      expect(within(row).getByText('1:02:05')).toBeInTheDocument();
      expect(within(row).getByText('Verified')).toBeInTheDocument();
    });
  });

  describe('when a row is unverified', () => {
    it('lists it under Unverified results with no rank and no tick', () => {
      renderBoard([UNVERIFIED]);

      const section = screen.getByRole('region', { name: 'Unverified results' });

      expect(within(section).getByText('Cy D.')).toBeInTheDocument();
      expect(within(section).getByText('Unverified')).toBeInTheDocument();
      expect(within(section).queryByText('Rank')).not.toBeInTheDocument();
      expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    });
  });

  describe('when there are only verified rows', () => {
    it('shows no unverified section', () => {
      renderBoard([VERIFIED]);

      expect(screen.queryByText('Unverified results')).not.toBeInTheDocument();
    });
  });

  describe('when a name contains markup', () => {
    it('renders it as text', () => {
      const { container } = renderBoard([{ ...VERIFIED, displayName: '<script>x</script> Q.' }]);

      expect(container.querySelector('script')).toBeNull();
      expect(screen.getByText('<script>x</script> Q.')).toBeInTheDocument();
    });
  });

  describe('when there are no rows', () => {
    it('shows an empty state', () => {
      renderBoard([]);

      expect(screen.getByText('No results on this page.')).toBeInTheDocument();
    });
  });

  describe('when results span pages', () => {
    it('links previous and next around a middle page', () => {
      renderBoard([VERIFIED], { total: 120, page: 2 });

      expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
        'href',
        '?division=X&page=1',
      );
      expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
        'href',
        '?division=X&page=3',
      );
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    });

    it('omits previous on the first page', () => {
      renderBoard([VERIFIED], { total: 120, page: 1 });

      expect(screen.queryByRole('link', { name: 'Previous page' })).not.toBeInTheDocument();
    });

    it('omits next on the last page', () => {
      renderBoard([VERIFIED], { total: 120, page: 3 });

      expect(screen.queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument();
    });
  });

  describe('when everything fits one page', () => {
    it('shows no pagination', () => {
      renderBoard([VERIFIED], { total: 10 });

      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    });
  });
});
