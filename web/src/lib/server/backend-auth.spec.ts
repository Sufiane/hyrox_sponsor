import { createBackendAuth } from './backend-auth.ts';

const BASE_URL = 'http://api.test';
const TOKENS = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('createBackendAuth', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  function backend(): ReturnType<typeof createBackendAuth> {
    return createBackendAuth({
      baseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  }

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  describe('login', () => {
    describe('when the backend answers 200', () => {
      it('posts credentials and returns the payload', async () => {
        const payload = {
          ...TOKENS,
          athlete: { id: '1', name: 'A', email: 'a@b.co', isAdult: true },
        };
        fetchImpl.mockResolvedValue(jsonResponse(payload, 200));

        const result = await backend().login('a@b.co', 'secret');

        expect(result).toEqual({ ok: true, value: payload });
        expect(fetchImpl).toHaveBeenCalledWith(`${BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.co', password: 'secret' }),
        });
      });
    });

    describe('when the backend answers 401', () => {
      it('returns the status and code', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({ message: 'invalid_credentials' }, 401));

        await expect(backend().login('a@b.co', 'bad')).resolves.toEqual({
          ok: false,
          status: 401,
          code: 'invalid_credentials',
        });
      });
    });

    describe('when the network rejects', () => {
      it('returns a 502 request_failed', async () => {
        fetchImpl.mockRejectedValue(new Error('down'));

        await expect(backend().login('a@b.co', 'x')).resolves.toEqual({
          ok: false,
          status: 502,
          code: 'request_failed',
        });
      });
    });
  });

  describe('signup', () => {
    describe('when the backend answers 201', () => {
      it('returns the payload', async () => {
        fetchImpl.mockResolvedValue(jsonResponse(TOKENS, 201));

        const result = await backend().signup({
          name: 'A',
          email: 'a@b.co',
          password: 'longenough1',
          adultAttested: true,
        });

        expect(result).toEqual({ ok: true, value: TOKENS });
        expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE_URL}/auth/signup`);
      });
    });
  });

  describe('refresh', () => {
    it('posts the refresh token', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(TOKENS, 200));

      await backend().refresh('old');

      expect(fetchImpl).toHaveBeenCalledWith(
        `${BASE_URL}/auth/refresh`,
        expect.objectContaining({ body: JSON.stringify({ refreshToken: 'old' }) }),
      );
    });
  });

  describe('logout', () => {
    describe('when the backend answers 204', () => {
      it('posts the refresh token', async () => {
        fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));

        await backend().logout('old');

        expect(fetchImpl).toHaveBeenCalledWith(
          `${BASE_URL}/auth/logout`,
          expect.objectContaining({ body: JSON.stringify({ refreshToken: 'old' }) }),
        );
      });
    });

    describe('when the network rejects', () => {
      it('still resolves', async () => {
        fetchImpl.mockRejectedValue(new Error('down'));

        await expect(backend().logout('old')).resolves.toBeUndefined();
      });
    });
  });
});
