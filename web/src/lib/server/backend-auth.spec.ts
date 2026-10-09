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

        const result = await backend().login('a@b.co', 'secret', null);

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

        await expect(backend().login('a@b.co', 'bad', null)).resolves.toEqual({
          ok: false,
          status: 401,
          code: 'invalid_credentials',
        });
      });
    });

    describe('when the network rejects', () => {
      it('returns a 502 request_failed', async () => {
        fetchImpl.mockRejectedValue(new Error('down'));

        await expect(backend().login('a@b.co', 'x', null)).resolves.toEqual({
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

        const result = await backend().signup(
          {
            name: 'A',
            email: 'a@b.co',
            password: 'longenough1',
            adultAttested: true,
          },
          null,
        );

        expect(result).toEqual({ ok: true, value: TOKENS });
        expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE_URL}/auth/signup`);
      });
    });
  });

  describe('refresh', () => {
    it('posts the refresh token', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(TOKENS, 200));

      await backend().refresh('old', null);

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

        await backend().logout('old', null);

        expect(fetchImpl).toHaveBeenCalledWith(
          `${BASE_URL}/auth/logout`,
          expect.objectContaining({ body: JSON.stringify({ refreshToken: 'old' }) }),
        );
      });
    });

    describe('when the network rejects', () => {
      it('still resolves', async () => {
        fetchImpl.mockRejectedValue(new Error('down'));

        await expect(backend().logout('old', null)).resolves.toBeUndefined();
      });
    });
  });

  describe('X-Forwarded-For', () => {
    const SIGNUP_INPUT = {
      name: 'A',
      email: 'a@b.co',
      password: 'longenough1',
      adultAttested: true,
    };

    function callWith(method: string, clientIp: string | null): Promise<unknown> {
      const api = backend();

      switch (method) {
        case 'login':
          return api.login('a@b.co', 'pw', clientIp);
        case 'signup':
          return api.signup(SIGNUP_INPUT, clientIp);
        case 'refresh':
          return api.refresh('old', clientIp);
        default:
          return api.logout('old', clientIp);
      }
    }

    beforeEach(() => {
      fetchImpl.mockImplementation(async () => jsonResponse(TOKENS, 200));
    });

    describe('when a client IP is given', () => {
      it.each(['login', 'signup', 'refresh', 'logout'])('sends it on %s', async (method) => {
        await callWith(method, '203.0.113.7');

        expect(fetchImpl.mock.calls[0][1].headers).toEqual({
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.7',
        });
      });
    });

    describe('when the client IP is null', () => {
      it.each(['login', 'signup', 'refresh', 'logout'])(
        'omits the header on %s',
        async (method) => {
          await callWith(method, null);

          expect(fetchImpl.mock.calls[0][1].headers).toEqual({
            'Content-Type': 'application/json',
          });
        },
      );
    });
  });
});
