import { createAuthApi } from './auth-api.ts';
import { AuthApiError } from './auth-types.ts';

const ATHLETE = { id: '1', name: 'A', email: 'a@b.co', isAdult: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('createAuthApi', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createAuthApi>;

  beforeEach(() => {
    fetchImpl = vi.fn();
    api = createAuthApi({ fetchImpl: fetchImpl as unknown as typeof fetch });
  });

  describe('login', () => {
    describe('when the BFF answers 200', () => {
      it('posts credentials and returns the grant', async () => {
        const grant = { accessToken: 'a', expiresIn: 900, athlete: ATHLETE };
        fetchImpl.mockResolvedValue(jsonResponse(grant));

        await expect(api.login('a@b.co', 'pw')).resolves.toEqual(grant);
        expect(fetchImpl).toHaveBeenCalledWith('/session/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.co', password: 'pw' }),
        });
      });
    });

    describe('when the BFF answers 401', () => {
      it('throws an AuthApiError with status and code', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({ message: 'invalid_credentials' }, 401));

        await expect(api.login('a@b.co', 'bad')).rejects.toMatchObject({
          status: 401,
          code: 'invalid_credentials',
        });
      });
    });

    describe('when the network rejects', () => {
      it('throws AuthApiError(0, request_failed)', async () => {
        fetchImpl.mockRejectedValue(new TypeError('offline'));

        const error = await api.login('a@b.co', 'pw').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(AuthApiError);
        expect(error).toMatchObject({ status: 0, code: 'request_failed' });
      });
    });
  });

  describe('signup', () => {
    it('sends the attestation', async () => {
      fetchImpl.mockResolvedValue(
        jsonResponse({ accessToken: 'a', expiresIn: 900, athlete: ATHLETE }, 201),
      );
      const input = { name: 'A', email: 'a@b.co', password: 'longenough1', adultAttested: true };

      await api.signup(input);

      expect(fetchImpl).toHaveBeenCalledWith(
        '/session/signup',
        expect.objectContaining({ body: JSON.stringify(input) }),
      );
    });
  });

  describe('refresh', () => {
    describe('when the BFF answers 200', () => {
      it('posts without a body and returns the access grant', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({ accessToken: 'b', expiresIn: 900 }));

        await expect(api.refresh()).resolves.toEqual({ accessToken: 'b', expiresIn: 900 });
        expect(fetchImpl).toHaveBeenCalledWith('/session/refresh', {
          method: 'POST',
          credentials: 'same-origin',
        });
      });
    });

    describe('when the BFF answers 401', () => {
      it('throws invalid_refresh_token', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({ message: 'invalid_refresh_token' }, 401));

        await expect(api.refresh()).rejects.toMatchObject({
          status: 401,
          code: 'invalid_refresh_token',
        });
      });
    });
  });

  describe('logout', () => {
    describe('when the call succeeds', () => {
      it('posts to the BFF', async () => {
        fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));

        await api.logout();

        expect(fetchImpl).toHaveBeenCalledWith('/session/logout', {
          method: 'POST',
          credentials: 'same-origin',
        });
      });
    });

    describe('when the network rejects', () => {
      it('still resolves', async () => {
        fetchImpl.mockRejectedValue(new TypeError('offline'));

        await expect(api.logout()).resolves.toBeUndefined();
      });
    });
  });
});
