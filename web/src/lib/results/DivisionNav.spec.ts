import { render, screen } from '@testing-library/svelte';
import DivisionNav from './DivisionNav.svelte';

const DIVISIONS = [
  { division: 'SINGLE_OPEN_MEN', resultCount: 3, verifiedCount: 2 },
  { division: 'RELAY_MIXED', resultCount: 1, verifiedCount: 1 },
] as const;

describe('DivisionNav', () => {
  function renderNav(current: string | null): void {
    render(DivisionNav, {
      divisions: [...DIVISIONS],
      current,
      hrefFor: (division: string) => `?division=${division}`,
    });
  }

  it('links each division with its label and count', () => {
    renderNav('SINGLE_OPEN_MEN');

    expect(screen.getByRole('link', { name: /Relay Mixed/ })).toHaveAttribute(
      'href',
      '?division=RELAY_MIXED',
    );
    expect(screen.getByRole('link', { name: 'Singles Open Men 3' })).toBeInTheDocument();
  });

  it('marks only the current division', () => {
    renderNav('RELAY_MIXED');

    expect(screen.getByRole('link', { name: /Relay Mixed/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /Singles Open Men/ })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
