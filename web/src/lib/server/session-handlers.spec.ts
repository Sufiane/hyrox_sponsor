import type { BackendAuth } from './backend-auth.ts';
import { createFakeJar } from './fake-jar.ts';
import { createSessionHandlers } from './session-handlers.ts';

const ATHLETE = { id: '1', name: 'A', email: 'a@b.co', isAdult: true };
const AUTH_PAYLOAD = {
  accessToken: 'access',
  refreshToken: 'secret-refresh',
  expiresIn: 900,
  athlete: ATHLETE,
};
const CONFIG = { secure: true, maxAgeSeconds: 2_592_000 };

function jsonRequest(body: unknown): Request {
  return new Request('http://web.test/session/x', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function createBackend(): { [Key in keyof BackendAuth]: ReturnType<typeof vi.fn> } {
  return { login: vi.fn(), signup: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
}

describe('createSessionHandlers', () => {
  let backend: ReturnType<typeof createBackend>;
  let handlers: ReturnType<typeof createSessionHandlers>;

  beforeEach(() => {
    backend = createBackend();
    handlers = createSessionHandlers({ backend: backend as unknown as BackendAuth, ...CONFIG });
  });

  describe('login', () => {
    describe('when the backend accepts the credentials', () => {
      it('sets the cookie and returns the grant without the refresh token', async () => {
        backend.login.mockResolvedValue({ ok: true, value: AUTH_PAYLOAD });
        const jar = createFakeJar();

        const response = await handlers.login(
          jsonRequest({ email: 'a@b.co', password: 'pw' }),
          jar,
        );

        expect(response.status).toBe(200);
        expect(jar.sets[0]).toMatchObject({ name: 'hyrox_refresh', value: 'secret-refresh' });
        const body = await response.json();
        expect(body).toEqual({ accessToken: 'access', expiresIn: 900, athlete: ATHLETE });
        expect(JSON.stringify(body)).not.toContain('secret-refresh');
      });
    });

    describe('when the backend rejects the credentials', () => {
      it('passes status and code through without a cookie', async () => {
        backend.login.mockResolvedValue({ ok: false, status: 401, code: 'invalid_credentials' });
        const jar = createFakeJar();

        const response = await handlers.login(jsonRequest({ email: 'a@b.co', password: 'x' }), jar);

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          statusCode: 401,
          message: 'invalid_credentials',
        });
        expect(jar.sets).toEqual([]);
      });
    });

    describe('when the body is not valid json', () => {
      it('answers 400 validation_failed', async () => {
        const response = await handlers.login(jsonRequest('{oops'), createFakeJar());

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ message: 'validation_failed' });
        expect(backend.login).not.toHaveBeenCalled();
      });
    });

    describe('when email or password is not a string', () => {
      it('answers 400 validation_failed', async () => {
        const response = await handlers.login(jsonRequest({ email: 1 }), createFakeJar());

        expect(response.status).toBe(400);
        expect(backend.login).not.toHaveBeenCalled();
      });
    });
  });

  describe('signup', () => {
    describe('when the backend creates the account', () => {
      it('sets the cookie and answers 201 without the refresh token', async () => {
        backend.signup.mockResolvedValue({ ok: true, value: AUTH_PAYLOAD });
        const jar = createFakeJar();

        const response = await handlers.signup(
          jsonRequest({
            name: 'A',
            email: 'a@b.co',
            password: 'longenough1',
            adultAttested: true,
            confirmPassword: 'longenough1',
          }),
          jar,
        );

        expect(response.status).toBe(201);
        expect(jar.sets[0].value).toBe('secret-refresh');
        expect(JSON.stringify(await response.json())).not.toContain('secret-refresh');
        expect(backend.signup).toHaveBeenCalledWith({
          name: 'A',
          email: 'a@b.co',
          password: 'longenough1',
          adultAttested: true,
        });
      });
    });

    describe('when the backend rejects the signup', () => {
      it('passes status and code through', async () => {
        backend.signup.mockResolvedValue({
          ok: false,
          status: 400,
          code: 'email_already_registered',
        });

        const response = await handlers.signup(
          jsonRequest({ name: 'A', email: 'a@b.co', password: 'longenough1', adultAttested: true }),
          createFakeJar(),
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ message: 'email_already_registered' });
      });
    });
  });

  describe('refresh', () => {
    describe('when there is no cookie', () => {
      it('answers 401 invalid_refresh_token', async () => {
        const response = await handlers.refresh(createFakeJar());

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ message: 'invalid_refresh_token' });
        expect(backend.refresh).not.toHaveBeenCalled();
      });
    });

    describe('when the backend rotates the token', () => {
      it('rewrites the cookie and returns only the access grant', async () => {
        backend.refresh.mockResolvedValue({
          ok: true,
          value: { accessToken: 'new', refreshToken: 'rotated-secret', expiresIn: 900 },
        });
        const jar = createFakeJar('old');

        const response = await handlers.refresh(jar);

        expect(backend.refresh).toHaveBeenCalledWith('old');
        expect(jar.sets[0]).toMatchObject({ value: 'rotated-secret' });
        const body = await response.json();
        expect(body).toEqual({ accessToken: 'new', expiresIn: 900 });
        expect(JSON.stringify(body)).not.toContain('rotated-secret');
      });
    });

    describe('when the backend answers 401', () => {
      it('clears the cookie and answers 401', async () => {
        backend.refresh.mockResolvedValue({
          ok: false,
          status: 401,
          code: 'invalid_refresh_token',
        });
        const jar = createFakeJar('old');

        const response = await handlers.refresh(jar);

        expect(response.status).toBe(401);
        expect(jar.deletes).toHaveLength(1);
      });
    });

    describe('when the backend is unreachable', () => {
      it('passes the status through and keeps the cookie', async () => {
        backend.refresh.mockResolvedValue({ ok: false, status: 502, code: 'request_failed' });
        const jar = createFakeJar('old');

        const response = await handlers.refresh(jar);

        expect(response.status).toBe(502);
        expect(jar.deletes).toEqual([]);
      });
    });
  });

  describe('logout', () => {
    describe('when a cookie is present', () => {
      it('revokes the token, clears the cookie and answers 204', async () => {
        const jar = createFakeJar('old');

        const response = await handlers.logout(jar);

        expect(backend.logout).toHaveBeenCalledWith('old');
        expect(jar.deletes).toHaveLength(1);
        expect(response.status).toBe(204);
      });
    });

    describe('when there is no cookie', () => {
      it('still clears and answers 204 without calling the backend', async () => {
        const jar = createFakeJar();

        const response = await handlers.logout(jar);

        expect(backend.logout).not.toHaveBeenCalled();
        expect(jar.deletes).toHaveLength(1);
        expect(response.status).toBe(204);
      });
    });
  });
});
