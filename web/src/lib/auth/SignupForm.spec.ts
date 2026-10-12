import type { Mock } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { TOS_VERSION } from '@hyrox-sponsor/shared/tos-version';
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

  async function fill(confirm: string, attest: boolean, tos = true): Promise<void> {
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'longenough1');
    await user.type(screen.getByLabelText('Confirm password'), confirm);

    if (attest) {
      await user.click(screen.getByLabelText('I am 18 or older'));
    }

    if (tos) {
      await user.click(screen.getByLabelText('I agree to the Terms of Service'));
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
        tosVersion: TOS_VERSION,
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

  describe('when the ToS box is unchecked', () => {
    it('blocks submit with a field error', async () => {
      await fill('longenough1', true, false);

      expect(await screen.findByText('You must agree to the Terms of Service.')).toBeInTheDocument();
      expect(session.signup).not.toHaveBeenCalled();
    });
  });

  describe('when the link is rendered', () => {
    it('opens the terms page in a new tab safely', () => {
      const link = screen.getByRole('link', { name: 'Terms of Service' });

      expect(link).toHaveAttribute('href', '/terms');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    });
  });

  describe('when the link is clicked', () => {
    it('leaves the checkbox unchecked', async () => {
      const link = screen.getByRole('link', { name: 'Terms of Service' });
      link.addEventListener('click', (event) => event.preventDefault());

      await user.click(link);

      expect(screen.getByLabelText('I agree to the Terms of Service')).not.toBeChecked();
    });
  });

  describe('when the server rejects with tos_version_mismatch', () => {
    it('shows the mapped message', async () => {
      session.signup.mockRejectedValue(new AuthApiError(400, 'tos_version_mismatch'));

      await fill('longenough1', true);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The Terms of Service were updated. Reload the page and agree again.',
      );
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
