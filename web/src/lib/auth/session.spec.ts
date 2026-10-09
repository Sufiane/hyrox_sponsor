import type { AuthApi } from './auth-api.ts';
import { AuthApiError } from './auth-types.ts';
import type { SessionAthlete } from './auth-types.ts';
import { createSession } from './session.svelte.ts';
import type { LockManagerLike } from './session.svelte.ts';

const ATHLETE: SessionAthlete = { id: '1', name: 'A', email: 'a@b.co', isAdult: true };
const LOCK_NAME = 'hyrox-session-refresh';

function createAuthApiFake(): { [Key in keyof AuthApi]: ReturnType<typeof vi.fn> } {
  return { login: vi.fn(), signup: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
}

describe('createSession', () => {
  let authApi: ReturnType<typeof createAuthApiFake>;
  let nowMs: number;
  let fetchMe: ReturnType<typeof vi.fn>;
  let locks: { request: ReturnType<typeof vi.fn> };

  function build(
    lockManager: LockManagerLike | null = locks as unknown as LockManagerLike,
  ): ReturnType<typeof createSession> {
    return createSession({
      authApi: authApi as unknown as AuthApi,
      now: () => nowMs,
      locks: lockManager,
      fetchMe: fetchMe as unknown as (token: string) => Promise<SessionAthlete | null>,
    });
  }

  beforeEach(() => {
    authApi = createAuthApiFake();
    nowMs = 1_000_000;
    fetchMe = vi.fn().mockResolvedValue(ATHLETE);
    locks = { request: vi.fn((_name: string, callback: () => Promise<unknown>) => callback()) };
  });

  describe('bootstrap', () => {
    describe('when the refresh succeeds', () => {
      it('becomes authenticated with the athlete', async () => {
        authApi.refresh.mockResolvedValue({ accessToken: 'tok', expiresIn: 900 });
        const session = build();

        await session.bootstrap();

        expect(session.status).toBe('authenticated');
        expect(session.getAccessToken()).toBe('tok');
        expect(session.athlete).toEqual(ATHLETE);
        expect(fetchMe).toHaveBeenCalledWith('tok');
      });
    });

    describe('when the athlete lookup fails', () => {
      it('stays authenticated with a null athlete', async () => {
        authApi.refresh.mockResolvedValue({ accessToken: 'tok', expiresIn: 900 });
        fetchMe.mockRejectedValue(new Error('boom'));
        const session = build();

        await session.bootstrap();

        expect(session.status).toBe('authenticated');
        expect(session.athlete).toBeNull();
      });
    });

    describe('when the refresh answers 401', () => {
      it('becomes anonymous without a token', async () => {
        authApi.refresh.mockRejectedValue(new AuthApiError(401, 'invalid_refresh_token'));
        const session = build();

        await session.bootstrap();

        expect(session.status).toBe('anonymous');
        expect(session.getAccessToken()).toBeNull();
      });
    });

    describe('when the network fails', () => {
      it('becomes anonymous', async () => {
        authApi.refresh.mockRejectedValue(new AuthApiError(0, 'request_failed'));
        const session = build();

        await session.bootstrap();

        expect(session.status).toBe('anonymous');
      });
    });

    describe('when called twice', () => {
      it('refreshes once', async () => {
        authApi.refresh.mockResolvedValue({ accessToken: 'tok', expiresIn: 900 });
        const session = build();

        await Promise.all([session.bootstrap(), session.bootstrap()]);
        await session.bootstrap();

        expect(authApi.refresh).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('refresh', () => {
    describe('when five calls run concurrently', () => {
      it('calls the api once and resolves all true', async () => {
        authApi.refresh.mockResolvedValue({ accessToken: 'tok', expiresIn: 900 });
        const session = build();

        const results = await Promise.all([1, 2, 3, 4, 5].map(() => session.refresh()));

        expect(results).toEqual([true, true, true, true, true]);
        expect(authApi.refresh).toHaveBeenCalledTimes(1);
      });
    });

    describe('when locks are provided', () => {
      it('requests the shared lock', async () => {
        authApi.refresh.mockResolvedValue({ accessToken: 'tok', expiresIn: 900 });

        await build().refresh();

        expect(locks.request).toHaveBeenCalledWith(LOCK_NAME, expect.any(Function));
      });
    });

    describe('when locks are unavailable', () => {
      it('still refreshes', async () => {
        authApi.refresh.mockResolvedValue({ accessToken: 'tok', expiresIn: 900 });
        const session = build(null);

        await expect(session.refresh()).resolves.toBe(true);
      });
    });

    describe('when the refresh answers 401', () => {
      it('clears the session and returns false', async () => {
        authApi.refresh.mockResolvedValueOnce({ accessToken: 'tok', expiresIn: 900 });
        const session = build();
        await session.refresh();
        authApi.refresh.mockRejectedValue(new AuthApiError(401, 'invalid_refresh_token'));

        await expect(session.refresh()).resolves.toBe(false);

        expect(session.status).toBe('anonymous');
        expect(session.getAccessToken()).toBeNull();
      });
    });
  });

  describe('when the lock request rejects', () => {
    beforeEach(() => {
      locks.request.mockRejectedValue(new Error('lock_unavailable'));
    });

    describe('and no token is held', () => {
      it('bootstrap settles anonymous', async () => {
        const session = build();

        await session.bootstrap();

        expect(session.status).toBe('anonymous');
      });
    });

    describe('and a token is held', () => {
      it('refresh returns false and keeps the session', async () => {
        authApi.login.mockResolvedValue({ accessToken: 'tok', expiresIn: 900, athlete: ATHLETE });
        const session = build();
        await session.login('a@b.co', 'pw');

        await expect(session.refresh()).resolves.toBe(false);

        expect(session.status).toBe('authenticated');
        expect(session.getAccessToken()).toBe('tok');
      });
    });
  });

  describe('refresh failing without an auth failure', () => {
    beforeEach(() => {
      authApi.refresh.mockResolvedValueOnce({ accessToken: 'tok', expiresIn: 900 });
    });

    describe.each([
      ['a network error', new AuthApiError(0, 'request_failed')],
      ['a 5xx', new AuthApiError(502, 'request_failed')],
    ])('when the refresh hits %s', (_label, failure) => {
      it('keeps the session and returns false', async () => {
        const session = build();
        await session.refresh();
        authApi.refresh.mockRejectedValue(failure);

        await expect(session.refresh()).resolves.toBe(false);

        expect(session.status).toBe('authenticated');
        expect(session.getAccessToken()).toBe('tok');
      });
    });
  });

  describe('isExpiringSoon', () => {
    beforeEach(() => {
      authApi.refresh.mockResolvedValue({ accessToken: 'tok', expiresIn: 60 });
    });

    describe('when 60 seconds remain', () => {
      it('is false', async () => {
        const session = build();
        await session.refresh();

        expect(session.isExpiringSoon()).toBe(false);
      });
    });

    describe('when 29 seconds remain', () => {
      it('is true', async () => {
        const session = build();
        await session.refresh();
        nowMs += 31_000;

        expect(session.isExpiringSoon()).toBe(true);
      });
    });

    describe('when there is no token', () => {
      it('is true', () => {
        expect(build().isExpiringSoon()).toBe(true);
      });
    });
  });

  describe('login', () => {
    describe('when the credentials are accepted', () => {
      it('becomes authenticated', async () => {
        authApi.login.mockResolvedValue({ accessToken: 'tok', expiresIn: 900, athlete: ATHLETE });
        const session = build();

        await session.login('a@b.co', 'pw');

        expect(session.status).toBe('authenticated');
        expect(session.athlete).toEqual(ATHLETE);
        expect(session.getAccessToken()).toBe('tok');
      });
    });

    describe('when the credentials are rejected', () => {
      it('rethrows and stays anonymous', async () => {
        authApi.login.mockRejectedValue(new AuthApiError(401, 'invalid_credentials'));
        const session = build();

        await expect(session.login('a@b.co', 'bad')).rejects.toMatchObject({ status: 401 });

        expect(session.status).not.toBe('authenticated');
        expect(session.getAccessToken()).toBeNull();
      });
    });
  });

  describe('signup', () => {
    it('becomes authenticated', async () => {
      authApi.signup.mockResolvedValue({ accessToken: 'tok', expiresIn: 900, athlete: ATHLETE });
      const session = build();

      await session.signup({
        name: 'A',
        email: 'a@b.co',
        password: 'longenough1',
        adultAttested: true,
      });

      expect(session.status).toBe('authenticated');
    });
  });

  describe('logout', () => {
    describe('when the api call rejects', () => {
      it('still clears local state', async () => {
        authApi.login.mockResolvedValue({ accessToken: 'tok', expiresIn: 900, athlete: ATHLETE });
        authApi.logout.mockRejectedValue(new Error('down'));
        const session = build();
        await session.login('a@b.co', 'pw');

        await session.logout();

        expect(session.status).toBe('anonymous');
        expect(session.athlete).toBeNull();
        expect(session.getAccessToken()).toBeNull();
      });
    });
  });
});
