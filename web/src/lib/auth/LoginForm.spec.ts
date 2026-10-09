import type { Mock } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { AuthApiError } from './auth-types.ts';
import LoginForm from './LoginForm.svelte';
import { createFakeSession } from './test-session.ts';
import type { FakeSession } from './test-session.ts';

describe('LoginForm', () => {
  let session: FakeSession;
  let onsuccess: Mock<() => void>;

  beforeEach(() => {
    session = createFakeSession();
    onsuccess = vi.fn<() => void>();
    render(LoginForm, { session, onsuccess });
  });

  async function fillAndSubmit(email: string, password: string): Promise<void> {
    const user = userEvent.setup();

    if (email !== '') {
      await user.type(screen.getByLabelText('Email'), email);
    }

    if (password !== '') {
      await user.type(screen.getByLabelText('Password'), password);
    }

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  describe('when the credentials are accepted', () => {
    it('logs in with the trimmed email and calls onsuccess', async () => {
      await fillAndSubmit(' a@b.co ', 'secret');

      expect(session.login).toHaveBeenCalledWith('a@b.co', 'secret');
      expect(onsuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the credentials are rejected', () => {
    it('shows the incorrect-credentials message', async () => {
      session.login.mockRejectedValue(new AuthApiError(401, 'invalid_credentials'));

      await fillAndSubmit('a@b.co', 'bad');

      expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
      expect(onsuccess).not.toHaveBeenCalled();
    });
  });

  describe('when the email is empty', () => {
    it('blocks submit and shows a field error', async () => {
      await fillAndSubmit('', 'secret');

      expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
      expect(session.login).not.toHaveBeenCalled();
    });
  });

  describe('while the request is pending', () => {
    it('disables the submit button', async () => {
      session.login.mockReturnValue(new Promise(() => undefined));

      await fillAndSubmit('a@b.co', 'secret');

      expect(await screen.findByRole('button', { name: 'Signing in...' })).toBeDisabled();
    });
  });
});
