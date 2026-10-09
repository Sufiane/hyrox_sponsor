import type { Mock } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render, screen } from '@testing-library/svelte';
import AuthGate from './AuthGate.svelte';
import { createFakeSession } from './test-session.ts';

const children = createRawSnippet(() => ({ render: (): string => '<p>secret content</p>' }));

describe('AuthGate', () => {
  let goto: Mock<(url: string) => void>;

  beforeEach(() => {
    goto = vi.fn<(url: string) => void>();
  });

  describe('when the session is loading', () => {
    it('shows status text and hides children', () => {
      render(AuthGate, { session: createFakeSession('loading'), goto, children });

      expect(screen.getByRole('status')).toHaveTextContent('Checking session...');
      expect(screen.queryByText('secret content')).not.toBeInTheDocument();
      expect(goto).not.toHaveBeenCalled();
    });
  });

  describe('when the session is anonymous', () => {
    it('redirects to login once with the encoded next path', () => {
      window.history.pushState({}, '', '/dev/body-map?x=1');

      render(AuthGate, { session: createFakeSession('anonymous'), goto, children });

      expect(goto).toHaveBeenCalledTimes(1);
      expect(goto).toHaveBeenCalledWith('/login?next=%2Fdev%2Fbody-map%3Fx%3D1');
      expect(screen.queryByText('secret content')).not.toBeInTheDocument();
    });
  });

  describe('when the session is authenticated', () => {
    it('renders children', () => {
      render(AuthGate, { session: createFakeSession('authenticated'), goto, children });

      expect(screen.getByText('secret content')).toBeInTheDocument();
      expect(goto).not.toHaveBeenCalled();
    });
  });
});
