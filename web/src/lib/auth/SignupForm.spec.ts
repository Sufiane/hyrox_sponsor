import type { Mock } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { AuthApiError } from './auth-types.ts';
import SignupForm from './SignupForm.svelte';
import { createFakeSession } from './test-session.ts';
import type { FakeSession } from './test-session.ts';

describe('SignupForm', () => {
  let session: FakeSession;
  let onsuccess: Mock<() => void>;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    session = createFakeSession();
    onsuccess = vi.fn<() => void>();
    user = userEvent.setup();
    render(SignupForm, { session, onsuccess });
  });

  async function fill(confirm: string, attest: boolean): Promise<void> {
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'longenough1');
    await user.type(screen.getByLabelText('Confirm password'), confirm);

    if (attest) {
      await user.click(screen.getByLabelText('I am 18 or older'));
    }

    await user.click(screen.getByRole('button', { name: 'Create account' }));
  }

  describe('when everything is valid', () => {
    it('signs up without the confirm password and calls onsuccess', async () => {
      await fill('longenough1', true);

      expect(session.signup).toHaveBeenCalledWith({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'longenough1',
        adultAttested: true,
      });
      expect(onsuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the attestation is unchecked', () => {
    it('blocks submit with a field error', async () => {
      await fill('longenough1', false);

      expect(await screen.findByText('You must confirm you are 18 or older.')).toBeInTheDocument();
      expect(session.signup).not.toHaveBeenCalled();
    });
  });

  describe('when the confirm password differs', () => {
    it('blocks submit with a mismatch error', async () => {
      await fill('different123', true);

      expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
      expect(session.signup).not.toHaveBeenCalled();
    });
  });

  describe('when the email is already registered', () => {
    it('shows the mapped message', async () => {
      session.signup.mockRejectedValue(new AuthApiError(400, 'email_already_registered'));

      await fill('longenough1', true);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'That email is already registered.',
      );
    });
  });
});
