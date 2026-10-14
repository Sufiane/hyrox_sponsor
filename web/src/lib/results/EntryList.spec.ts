import { render, screen, within } from '@testing-library/svelte';
import EntryList from './EntryList.svelte';
import type { OwnEntry } from './results-types.ts';

const ENTRY: OwnEntry = {
  raceEntryId: 'e 1',
  raceName: 'Hyrox Berlin',
  raceDate: '2026-10-10T23:30:00.000Z',
  timezone: 'Europe/Berlin',
  division: 'SINGLE_PRO_MEN',
  bibVerificationStatus: 'PENDING',
  resultStatus: null,
};

describe('EntryList', () => {
  describe('when an entry has no result', () => {
    it('shows details and an Add result link', () => {
      render(EntryList, { entries: [ENTRY] });

      const row = screen.getByRole('row', { name: /Hyrox Berlin/ });

      expect(within(row).getByText('11 October 2026')).toBeInTheDocument();
      expect(within(row).getByText('Singles Pro Men')).toBeInTheDocument();
      expect(within(row).getByText('Awaiting review')).toBeInTheDocument();
      expect(within(row).getByText('No result')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Add result for Hyrox Berlin' })).toHaveAttribute(
        'href',
        '/results/submit/e%201',
      );
    });
  });

  describe('when an entry has a result', () => {
    it('shows its status and an Edit result link', () => {
      render(EntryList, {
        entries: [{ ...ENTRY, resultStatus: 'REJECTED', bibVerificationStatus: 'VERIFIED' }],
      });

      expect(screen.getByText('Rejected')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Edit result for Hyrox Berlin' }),
      ).toBeInTheDocument();
    });
  });

  describe('when there are no entries', () => {
    it('explains that entries come from race logging', () => {
      render(EntryList, { entries: [] });

      expect(screen.getByText('You have no race entries yet.')).toBeInTheDocument();
      expect(
        screen.getByText(/Logging a race from the website is not available yet/),
      ).toBeInTheDocument();
    });
  });
});
