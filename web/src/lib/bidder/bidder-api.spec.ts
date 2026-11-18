import type { Mock } from 'vitest';
import { createBidderApi } from './bidder-api.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createBidderApi', () => {
  let fetchImpl: Mock<typeof fetch>;

  beforeEach(() => {
    fetchImpl = vi.fn<typeof fetch>();
  });

  describe('createSetupIntent', () => {
    describe('when no token is stored', () => {
      beforeEach(() => {
        fetchImpl.mockResolvedValue(
          jsonResponse(
            { clientSecret: 'seti_secret', bidderToken: 'a.b.c', bidderTokenExpiresAt: '2026-11-18T00:00:00.000Z' },
            201,
          ),
        );
      });

      it('posts the email without a token header', async () => {
        await createBidderApi('http://api.test', fetchImpl).createSetupIntent('guest@example.com', null);

        expect(fetchImpl).toHaveBeenCalledWith('http://api.test/bidders/setup-intents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'guest@example.com' }),
        });
      });

      it('returns the response body', async () => {
        await expect(
          createBidderApi('http://api.test', fetchImpl).createSetupIntent('guest@example.com', null),
        ).resolves.toEqual({
          ok: true,
          value: {
            clientSecret: 'seti_secret',
            bidderToken: 'a.b.c',
            bidderTokenExpiresAt: '2026-11-18T00:00:00.000Z',
          },
        });
      });
    });

    describe('when a token is stored', () => {
      it('sends it in X-Bidder-Token', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({}, 201));

        await createBidderApi('http://api.test', fetchImpl).createSetupIntent('guest@example.com', 'a.b.c');

        expect(fetchImpl).toHaveBeenCalledWith(
          'http://api.test/bidders/setup-intents',
          expect.objectContaining({ headers: { 'content-type': 'application/json', 'x-bidder-token': 'a.b.c' } }),
        );
      });
    });

    describe('when the API rejects the token', () => {
      it('returns the error code and status', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({ message: 'bidder_token_required' }, 401));

        await expect(
          createBidderApi('http://api.test', fetchImpl).createSetupIntent('guest@example.com', null),
        ).resolves.toEqual({ ok: false, status: 401, code: 'bidder_token_required' });
      });
    });
  });
});
