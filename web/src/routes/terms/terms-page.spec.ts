import { render, screen, within } from '@testing-library/svelte';
import { TOS_VERSION } from '@hyrox-sponsor/shared/tos-version';
import { TOS_SECTIONS } from '../../lib/legal/terms.ts';
import TermsPage from './+page.svelte';

const DRAFT = 'DRAFT - not legal advice. Placeholder terms pending review.';
const state = vi.hoisted(() => ({ notice: null as string | null }));

vi.mock('../../lib/legal/terms.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/legal/terms.ts')>();

  return {
    ...original,
    get TOS_DRAFT_NOTICE(): string | null {
      return state.notice;
    },
  };
});

describe('terms page', () => {
  describe('when rendered', () => {
    beforeEach(() => {
      render(TermsPage);
    });

    it('shows the title as the main heading', () => {
      expect(
        screen.getByRole('heading', { level: 1, name: 'Terms of Service' }),
      ).toBeInTheDocument();
    });

    it('shows an h2 for every section', () => {
      for (const section of TOS_SECTIONS) {
        expect(
          screen.getByRole('heading', { level: 2, name: new RegExp(section.heading) }),
        ).toBeInTheDocument();
      }
    });

    it('shows the version', () => {
      expect(screen.getByText(TOS_VERSION, { exact: false })).toBeInTheDocument();
    });

    it('links back to signup', () => {
      expect(screen.getByRole('link', { name: 'Back to create account' })).toHaveAttribute(
        'href',
        '/signup',
      );
    });

    it('links the contents to each section', () => {
      const contents = screen.getByRole('navigation', { name: 'Contents' });

      expect(within(contents).getAllByRole('link')).toHaveLength(TOS_SECTIONS.length);
    });
  });

  describe('when the draft notice is set', () => {
    it('shows the banner', () => {
      state.notice = DRAFT;
      render(TermsPage);

      expect(screen.getByRole('note')).toHaveTextContent('DRAFT - not legal advice');
    });
  });

  describe('when the draft notice is null', () => {
    it('hides the banner', () => {
      state.notice = null;
      render(TermsPage);

      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });
  });
});
