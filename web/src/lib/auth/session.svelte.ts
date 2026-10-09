import { createAuthApi } from './auth-api.ts';
import type { AuthApi } from './auth-api.ts';
import { AuthApiError } from './auth-types.ts';
import type { AccessGrant, SessionAthlete, SignupInput } from './auth-types.ts';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface SessionDeps {
  authApi: AuthApi;
  now?: () => number;
  locks?: LockManagerLike | null;
  fetchMe?: (token: string) => Promise<SessionAthlete | null>;
}

export interface Session {
  readonly status: SessionStatus;
  readonly athlete: SessionAthlete | null;
  bootstrap(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  signup(input: SignupInput): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<boolean>;
  getAccessToken(): string | null;
  isExpiringSoon(): boolean;
}

const LOCK_NAME = 'hyrox-session-refresh';
const EXPIRY_MARGIN_MS = 30_000;

async function fetchAthlete(token: string): Promise<SessionAthlete | null> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
  const response = await fetch(`${baseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as SessionAthlete;

  return { id: body.id, name: body.name, email: body.email, isAdult: body.isAdult };
}

export function createSession(deps: SessionDeps): Session {
  const now = deps.now ?? Date.now;
  const locks = deps.locks ?? null;
  const fetchMe = deps.fetchMe ?? fetchAthlete;

  let status = $state<SessionStatus>('loading');
  let athlete = $state<SessionAthlete | null>(null);
  let accessToken: string | null = null;
  let expiresAt = 0;
  let inflight: Promise<boolean> | null = null;
  let bootstrapped: Promise<void> | null = null;

  function hold(grant: AccessGrant): void {
    accessToken = grant.accessToken;
    expiresAt = now() + grant.expiresIn * 1000;
    status = 'authenticated';
  }

  function clear(): void {
    accessToken = null;
    expiresAt = 0;
    athlete = null;
    status = 'anonymous';
  }

  function isExpiringSoon(): boolean {
    return accessToken == null || expiresAt - now() < EXPIRY_MARGIN_MS;
  }

  function failSoft(): boolean {
    if (accessToken == null) {
      status = 'anonymous';
    }

    return false;
  }

  async function callRefresh(): Promise<boolean> {
    try {
      hold(await deps.authApi.refresh());

      return true;
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        clear();

        return false;
      }

      return failSoft();
    }
  }

  function refresh(): Promise<boolean> {
    if (inflight != null) {
      return inflight;
    }

    const run =
      locks == null ? callRefresh() : locks.request(LOCK_NAME, callRefresh).catch(failSoft);

    inflight = run.finally(() => {
      inflight = null;
    });

    return inflight;
  }

  async function runBootstrap(): Promise<void> {
    if (!(await refresh()) || accessToken == null) {
      return;
    }

    try {
      athlete = await fetchMe(accessToken);
    } catch {
      athlete = null;
    }
  }

  function bootstrap(): Promise<void> {
    bootstrapped ??= runBootstrap();

    return bootstrapped;
  }

  async function login(email: string, password: string): Promise<void> {
    const grant = await deps.authApi.login(email, password);

    hold(grant);
    athlete = grant.athlete;
  }

  async function signup(input: SignupInput): Promise<void> {
    const grant = await deps.authApi.signup(input);

    hold(grant);
    athlete = grant.athlete;
  }

  async function logout(): Promise<void> {
    await deps.authApi.logout().catch(() => undefined);
    clear();
  }

  return {
    get status(): SessionStatus {
      return status;
    },
    get athlete(): SessionAthlete | null {
      return athlete;
    },
    bootstrap,
    login,
    signup,
    logout,
    refresh,
    getAccessToken: () => accessToken,
    isExpiringSoon,
  };
}

export const session: Session = createSession({
  authApi: createAuthApi(),
  locks: typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null,
});
