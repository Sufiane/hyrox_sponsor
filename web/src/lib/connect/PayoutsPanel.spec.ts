import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import type { Mock } from 'vitest';
import PayoutsPanel from './PayoutsPanel.svelte';
import type { ApiResult } from '../results/api-result.ts';
import type { ConnectApi, ConnectStatus, ConnectStatusResponse, OnboardingLink } from './connect-api.ts';

const LINK: OnboardingLink = {
  url: 'https://connect.stripe.test/abc',
  expiresAt: '2026-11-11T10:00:00.000Z',
};

const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 3;

function statusResult(
  status: ConnectStatus,
  requirementsDue: string[] | null = null,
): ApiResult<ConnectStatusResponse> {
  return { ok: true, value: { status, requirementsDue } };
}

describe('PayoutsPanel', () => {
  let fetchConnectStatus: Mock<ConnectApi['fetchConnectStatus']>;
  let requestOnboardingLink: Mock<ConnectApi['requestOnboardingLink']>;
  let redirect: Mock<(url: string) => void>;
  let onrefreshattempted: Mock<() => void>;
  let user: UserEvent;

  async function flush(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  async function renderPanel(
    props: { returned?: boolean; refreshed?: boolean } = {},
  ): Promise<{ unmount: () => void }> {
    const view = render(PayoutsPanel, {
      api: { fetchConnectStatus, requestOnboardingLink },
      redirect,
      onrefreshattempted,
      pollIntervalMs: POLL_INTERVAL_MS,
      maxPolls: MAX_POLLS,
      ...props,
    });

    await flush();

    return view;
  }

  async function click(name: string): Promise<void> {
    await user.click(screen.getByRole('button', { name }));
    await flush();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    fetchConnectStatus = vi.fn<ConnectApi['fetchConnectStatus']>();
    requestOnboardingLink = vi.fn<ConnectApi['requestOnboardingLink']>().mockResolvedValue({ ok: true, value: LINK });
    redirect = vi.fn<(url: string) => void>();
    onrefreshattempted = vi.fn<() => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('while the status is loading', () => {
    beforeEach(() => {
      fetchConnectStatus.mockReturnValue(new Promise(() => undefined));
    });

    it('announces loading', async () => {
      await renderPanel();

      expect(screen.getByRole('status')).toHaveTextContent('Loading payout status...');
    });
  });

  describe.each([
    ['NOT_STARTED', 'Not started', 'Set up payouts'],
    ['INCOMPLETE', 'Setup incomplete', 'Continue setup'],
    ['RESTRICTED', 'Action needed', 'Fix payout details'],
  ] as const)('when the status is %s', (status, badge, action) => {
    beforeEach(async () => {
      fetchConnectStatus.mockResolvedValue(statusResult(status));
      await renderPanel();
    });

    it('shows the badge', () => {
      expect(screen.getByText(badge)).toBeInTheDocument();
    });

    it('shows the action button', () => {
      expect(screen.getByRole('button', { name: action })).toBeEnabled();
    });

    describe('when the button is clicked', () => {
      it('redirects to the returned url', async () => {
        await click(action);

        expect(redirect).toHaveBeenCalledWith(LINK.url);
      });
    });
  });

  describe('when the status is READY', () => {
    beforeEach(async () => {
      fetchConnectStatus.mockResolvedValue(statusResult('READY'));
      await renderPanel();
    });

    it('shows the badge', () => {
      expect(screen.getByText('Ready for payouts')).toBeInTheDocument();
    });

    it('shows no action button', () => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('when requirements are due', () => {
    describe.each(['INCOMPLETE', 'RESTRICTED'] as const)('when the status is %s', (status) => {
      beforeEach(async () => {
        fetchConnectStatus.mockResolvedValue(
          statusResult(status, ['external_account', 'individual.dob.day', 'individual.dob.year']),
        );
        await renderPanel();
      });

      it('lists the friendly labels once each', () => {
        const items = screen.getAllByRole('listitem').map((item) => item.textContent);

        expect(items).toEqual(['Bank account or debit card', 'Date of birth']);
      });

      it('shows the heading', () => {
        expect(screen.getByText('Stripe still needs:')).toBeInTheDocument();
      });

      it('keeps the live region free of the list', () => {
        expect(screen.getByRole('status')).not.toHaveTextContent('Date of birth');
      });
    });

    describe('when the status is NOT_STARTED', () => {
      it('shows no list', async () => {
        fetchConnectStatus.mockResolvedValue(statusResult('NOT_STARTED', ['external_account']));
        await renderPanel();

        expect(screen.queryByRole('list')).not.toBeInTheDocument();
      });
    });

    describe('when the status is READY', () => {
      it('shows no list', async () => {
        fetchConnectStatus.mockResolvedValue(statusResult('READY', ['external_account']));
        await renderPanel();

        expect(screen.queryByRole('list')).not.toBeInTheDocument();
      });
    });
  });

  describe('when requirementsDue is null', () => {
    it('shows no list', async () => {
      fetchConnectStatus.mockResolvedValue(statusResult('INCOMPLETE', null));
      await renderPanel();

      expect(screen.queryByText('Stripe still needs:')).not.toBeInTheDocument();
    });
  });

  describe('when requirementsDue is empty', () => {
    it('shows no list', async () => {
      fetchConnectStatus.mockResolvedValue(statusResult('INCOMPLETE', []));
      await renderPanel();

      expect(screen.queryByText('Stripe still needs:')).not.toBeInTheDocument();
    });
  });

  describe('when requesting the link is in flight', () => {
    beforeEach(async () => {
      fetchConnectStatus.mockResolvedValue(statusResult('NOT_STARTED'));
      requestOnboardingLink.mockReturnValue(new Promise(() => undefined));
      await renderPanel();
      await click('Set up payouts');
    });

    it('disables the button', () => {
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('when the first status request fails', () => {
    beforeEach(async () => {
      fetchConnectStatus.mockResolvedValueOnce({
        ok: false,
        status: 403,
        code: 'athlete_banned',
      });
      await renderPanel();
    });

    it('shows the mapped error as an alert', () => {
      expect(screen.getByRole('alert')).toHaveTextContent('This account is suspended.');
    });

    describe('when Try again is clicked and the retry succeeds', () => {
      beforeEach(async () => {
        fetchConnectStatus.mockResolvedValue(statusResult('NOT_STARTED'));
        await click('Try again');
      });

      it('shows the status and clears the error', () => {
        expect(screen.getByText('Not started')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  describe('when the link request fails', () => {
    beforeEach(async () => {
      fetchConnectStatus.mockResolvedValue(statusResult('NOT_STARTED'));
      requestOnboardingLink.mockResolvedValue({
        ok: false,
        status: 502,
        code: 'stripe_unavailable',
      });
      await renderPanel();
      await click('Set up payouts');
    });

    it('shows the mapped error as an alert', () => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Our payment provider is unavailable right now. Try again shortly.',
      );
    });

    it('does not redirect', () => {
      expect(redirect).not.toHaveBeenCalled();
    });

    it('re-enables the button', () => {
      expect(screen.getByRole('button', { name: 'Set up payouts' })).toBeEnabled();
    });
  });

  describe('when the returned url is not https', () => {
    beforeEach(async () => {
      fetchConnectStatus.mockResolvedValue(statusResult('NOT_STARTED'));
    });

    it.each(['http://connect.stripe.test/abc', 'javascript:alert(1)', 'not a url'])(
      'rejects %s with a generic error',
      async (url) => {
        requestOnboardingLink.mockResolvedValue({ ok: true, value: { ...LINK, url } });
        await renderPanel();
        await click('Set up payouts');

        expect(redirect).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('invalid setup link');
        expect(screen.getByRole('button', { name: 'Set up payouts' })).toBeEnabled();
      },
    );
  });

  describe('when returning from onboarding', () => {
    describe('when the status becomes READY on a later poll', () => {
      beforeEach(async () => {
        fetchConnectStatus.mockResolvedValueOnce(statusResult('INCOMPLETE')).mockResolvedValue(statusResult('READY'));
        await renderPanel({ returned: true });
        await flush(POLL_INTERVAL_MS);
      });

      it('shows READY', () => {
        expect(screen.getByText('Ready for payouts')).toBeInTheDocument();
      });

      it('stops polling', async () => {
        await flush(POLL_INTERVAL_MS * 5);

        expect(fetchConnectStatus).toHaveBeenCalledTimes(2);
      });
    });

    describe('when the status never becomes READY', () => {
      beforeEach(async () => {
        fetchConnectStatus.mockResolvedValue(statusResult('INCOMPLETE'));
        await renderPanel({ returned: true });
        await flush(POLL_INTERVAL_MS * MAX_POLLS);
      });

      it('stops after the maximum polls', async () => {
        await flush(POLL_INTERVAL_MS * 5);

        expect(fetchConnectStatus).toHaveBeenCalledTimes(MAX_POLLS);
      });

      it('says setup is still being confirmed', () => {
        expect(screen.getByRole('status')).toHaveTextContent(/still being confirmed/i);
      });

      it('keeps the action button available', () => {
        expect(screen.getByRole('button', { name: 'Continue setup' })).toBeEnabled();
      });
    });

    describe('when a poll fails', () => {
      beforeEach(async () => {
        fetchConnectStatus.mockResolvedValue({
          ok: false,
          status: 502,
          code: 'stripe_unavailable',
        });
        await renderPanel({ returned: true });
        await flush(POLL_INTERVAL_MS * 5);
      });

      it('stops polling and shows the error', () => {
        expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
        expect(fetchConnectStatus).toHaveBeenCalledTimes(1);
      });
    });

    describe('when the panel unmounts mid-poll', () => {
      beforeEach(async () => {
        fetchConnectStatus.mockResolvedValue(statusResult('INCOMPLETE'));
        const view = await renderPanel({ returned: true });

        view.unmount();
        await flush(POLL_INTERVAL_MS * 5);
      });

      it('stops polling', () => {
        expect(fetchConnectStatus).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('when the onboarding link expired', () => {
    beforeEach(() => {
      fetchConnectStatus.mockResolvedValue(statusResult('INCOMPLETE'));
    });

    describe('when the request succeeds', () => {
      it('requests a fresh link and redirects', async () => {
        await renderPanel({ refreshed: true });

        expect(requestOnboardingLink).toHaveBeenCalledTimes(1);
        expect(redirect).toHaveBeenCalledWith(LINK.url);
      });

      it('reports the attempt', async () => {
        await renderPanel({ refreshed: true });

        expect(onrefreshattempted).toHaveBeenCalledTimes(1);
      });
    });

    describe('when the request fails', () => {
      beforeEach(async () => {
        requestOnboardingLink.mockResolvedValue({
          ok: false,
          status: 502,
          code: 'stripe_unavailable',
        });
        await renderPanel({ refreshed: true });
        await flush(POLL_INTERVAL_MS * 5);
      });

      it('shows the error with a manual button', () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue setup' })).toBeEnabled();
      });

      it('does not resend on its own', () => {
        expect(requestOnboardingLink).toHaveBeenCalledTimes(1);
      });

      it('reports the attempt so the param can be stripped', () => {
        expect(onrefreshattempted).toHaveBeenCalledTimes(1);
      });
    });

    describe('when the panel unmounts before the link arrives', () => {
      beforeEach(async () => {
        let resolveLink: (result: ApiResult<OnboardingLink>) => void = () => undefined;

        requestOnboardingLink.mockReturnValue(
          new Promise((resolve) => {
            resolveLink = resolve;
          }),
        );
        const view = await renderPanel({ refreshed: true });

        view.unmount();
        resolveLink({ ok: true, value: LINK });
        await flush();
      });

      it('does not redirect', () => {
        expect(redirect).not.toHaveBeenCalled();
      });
    });
  });

  describe('when both return and refresh are set', () => {
    beforeEach(async () => {
      fetchConnectStatus.mockResolvedValue(statusResult('INCOMPLETE'));
      await renderPanel({ returned: true, refreshed: true });
      await flush(POLL_INTERVAL_MS * 5);
    });

    it('requests a link and does not poll', () => {
      expect(requestOnboardingLink).toHaveBeenCalledTimes(1);
      expect(fetchConnectStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('when neither return nor refresh is set', () => {
    beforeEach(async () => {
      fetchConnectStatus.mockResolvedValue(statusResult('NOT_STARTED'));
      await renderPanel();
    });

    it('fetches the status once and requests no link', () => {
      expect(fetchConnectStatus).toHaveBeenCalledTimes(1);
      expect(requestOnboardingLink).not.toHaveBeenCalled();
    });

    it('does not report a refresh attempt', () => {
      expect(onrefreshattempted).not.toHaveBeenCalled();
    });
  });
});
