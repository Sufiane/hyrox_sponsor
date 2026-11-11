import type { Mock } from 'vitest';
import { NotAuthenticatedError } from '../auth/auth-types.ts';
import { createConnectApi } from './connect-api.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createConnectApi', () => {
  let fetchImpl: Mock<typeof fetch>;

  function build(): ReturnType<typeof createConnectApi> {
    return createConnectApi('http://api.test', fetchImpl);
  }

  beforeEach(() => {
    fetchImpl = vi.fn<typeof fetch>();
  });

  describe('fetchConnectStatus', () => {
    describe('when the request succeeds', () => {
      beforeEach(() => {
        fetchImpl.mockResolvedValue(jsonResponse({ status: 'INCOMPLETE', requirementsDue: ['external_account'] }));
      });

      it('sends a GET to the status endpoint', async () => {
        await build().fetchConnectStatus();

        expect(fetchImpl).toHaveBeenCalledWith('http://api.test/athletes/me/connect/status', {
          method: 'GET',
        });
      });

      it('returns the status and requirements due', async () => {
        await expect(build().fetchConnectStatus()).resolves.toEqual({
          ok: true,
          value: { status: 'INCOMPLETE', requirementsDue: ['external_account'] },
        });
      });
    });

    describe.each([
      ['null', null],
      ['missing', undefined],
      ['not an array', 'external_account'],
      ['an array with non-strings', ['external_account', 3]],
    ])('when requirementsDue is %s', (_label, requirementsDue) => {
      beforeEach(() => {
        fetchImpl.mockResolvedValue(jsonResponse({ status: 'INCOMPLETE', requirementsDue }));
      });

      it('returns null requirements', async () => {
        await expect(build().fetchConnectStatus()).resolves.toEqual({
          ok: true,
          value: { status: 'INCOMPLETE', requirementsDue: null },
        });
      });
    });

    describe('when requirementsDue is an empty array', () => {
      beforeEach(() => {
        fetchImpl.mockResolvedValue(jsonResponse({ status: 'READY', requirementsDue: [] }));
      });

      it('keeps the empty array', async () => {
        await expect(build().fetchConnectStatus()).resolves.toEqual({
          ok: true,
          value: { status: 'READY', requirementsDue: [] },
        });
      });
    });

    describe('when the API returns an error code', () => {
      beforeEach(() => {
        fetchImpl.mockResolvedValue(jsonResponse({ message: 'athlete_banned' }, 403));
      });

      it('passes the code and status through', async () => {
        await expect(build().fetchConnectStatus()).resolves.toEqual({
          ok: false,
          status: 403,
          code: 'athlete_banned',
        });
      });
    });

    describe('when the session cannot be refreshed', () => {
      beforeEach(() => {
        fetchImpl.mockRejectedValue(new NotAuthenticatedError());
      });

      it('returns not_authenticated', async () => {
        await expect(build().fetchConnectStatus()).resolves.toEqual({
          ok: false,
          status: 401,
          code: 'not_authenticated',
        });
      });
    });

    describe('when the network fails', () => {
      beforeEach(() => {
        fetchImpl.mockRejectedValue(new TypeError('offline'));
      });

      it('returns request_failed', async () => {
        await expect(build().fetchConnectStatus()).resolves.toMatchObject({
          ok: false,
          code: 'request_failed',
        });
      });
    });
  });

  describe('requestOnboardingLink', () => {
    const link = { url: 'https://connect.stripe.test/abc', expiresAt: '2026-11-11T10:00:00.000Z' };

    describe('when the request succeeds', () => {
      beforeEach(() => {
        fetchImpl.mockResolvedValue(jsonResponse(link, 201));
      });

      it('sends a POST to the onboarding link endpoint', async () => {
        await build().requestOnboardingLink();

        expect(fetchImpl).toHaveBeenCalledWith('http://api.test/athletes/me/connect/onboarding-link', {
          method: 'POST',
        });
      });

      it('returns the link', async () => {
        await expect(build().requestOnboardingLink()).resolves.toEqual({
          ok: true,
          value: link,
        });
      });
    });

    describe('when the API returns an error code', () => {
      beforeEach(() => {
        fetchImpl.mockResolvedValue(jsonResponse({ message: 'stripe_unavailable' }, 502));
      });

      it('passes the code and status through', async () => {
        await expect(build().requestOnboardingLink()).resolves.toEqual({
          ok: false,
          status: 502,
          code: 'stripe_unavailable',
        });
      });
    });
  });
});
