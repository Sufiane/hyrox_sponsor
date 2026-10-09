import { createAuthedFetch } from './authed-fetch.ts';
import { NotAuthenticatedError } from './auth-types.ts';
import type { Session } from './session.svelte.ts';

type FakeSession = Pick<Session, 'getAccessToken' | 'isExpiringSoon' | 'refresh'>;

function response(status: number): Response {
  return new Response('{}', { status });
}

function authorizationOf(fetchImpl: ReturnType<typeof vi.fn>, call: number): string | null {
  const init = fetchImpl.mock.calls[call][1] as RequestInit;

  return new Headers(init.headers).get('Authorization');
}

describe('createAuthedFetch', () => {
  let token: string | null;
  let expiring: boolean;
  let refreshImpl: ReturnType<typeof vi.fn>;
  let fetchImpl: ReturnType<typeof vi.fn>;
  let authedFetch: typeof fetch;

  beforeEach(() => {
    token = 'old';
    expiring = false;
    refreshImpl = vi.fn(async () => {
      token = 'new';
      expiring = false;

      return true;
    });
    fetchImpl = vi.fn();
    const session: FakeSession = {
      getAccessToken: () => token,
      isExpiringSoon: () => expiring,
      refresh: refreshImpl as unknown as Session['refresh'],
    };
    authedFetch = createAuthedFetch({
      session: session as Session,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  });

  describe('when the token is fresh', () => {
    it('attaches the bearer token and keeps caller headers', async () => {
      fetchImpl.mockResolvedValue(response(200));

      await authedFetch('http://api.test/x', { headers: { 'Content-Type': 'application/json' } });

      expect(authorizationOf(fetchImpl, 0)).toBe('Bearer old');
      const init = fetchImpl.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
      expect(refreshImpl).not.toHaveBeenCalled();
    });
  });

  describe('when the token is expiring soon', () => {
    it('refreshes before sending', async () => {
      expiring = true;
      fetchImpl.mockResolvedValue(response(200));

      await authedFetch('http://api.test/x');

      expect(refreshImpl).toHaveBeenCalledTimes(1);
      expect(authorizationOf(fetchImpl, 0)).toBe('Bearer new');
    });
  });

  describe('when there is no token', () => {
    describe('and the refresh yields none', () => {
      it('throws NotAuthenticatedError without calling fetch', async () => {
        token = null;
        refreshImpl.mockResolvedValue(false);

        await expect(authedFetch('http://api.test/x')).rejects.toBeInstanceOf(
          NotAuthenticatedError,
        );
        expect(fetchImpl).not.toHaveBeenCalled();
      });
    });
  });

  describe('when the server answers 401', () => {
    describe('and the refresh succeeds', () => {
      it('retries once with the new token', async () => {
        fetchImpl.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200));

        const result = await authedFetch('http://api.test/x', { method: 'PUT', body: '{}' });

        expect(result.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(authorizationOf(fetchImpl, 1)).toBe('Bearer new');
        expect((fetchImpl.mock.calls[1][1] as RequestInit).body).toBe('{}');
      });
    });

    describe('and another request already rotated the token', () => {
      it('retries with the new token without refreshing again', async () => {
        fetchImpl
          .mockImplementationOnce(async () => {
            token = 'rotated';

            return response(401);
          })
          .mockResolvedValueOnce(response(200));

        const result = await authedFetch('http://api.test/x');

        expect(result.status).toBe(200);
        expect(refreshImpl).not.toHaveBeenCalled();
        expect(authorizationOf(fetchImpl, 1)).toBe('Bearer rotated');
      });
    });

    describe('and the retry is also 401', () => {
      it('returns the second response without looping', async () => {
        fetchImpl.mockResolvedValue(response(401));

        const result = await authedFetch('http://api.test/x');

        expect(result.status).toBe(401);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(refreshImpl).toHaveBeenCalledTimes(1);
      });
    });

    describe('and the refresh fails', () => {
      it('throws NotAuthenticatedError', async () => {
        fetchImpl.mockResolvedValue(response(401));
        refreshImpl.mockResolvedValue(false);

        await expect(authedFetch('http://api.test/x')).rejects.toBeInstanceOf(
          NotAuthenticatedError,
        );
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('when the server answers 500', () => {
    it('returns it without retrying', async () => {
      fetchImpl.mockResolvedValue(response(500));

      const result = await authedFetch('http://api.test/x');

      expect(result.status).toBe(500);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(refreshImpl).not.toHaveBeenCalled();
    });
  });
});
