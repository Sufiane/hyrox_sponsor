import { errorCode } from '../auth/error-code.ts';
import type { SessionAthlete, SignupInput } from '../auth/auth-types.ts';

export interface BackendTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface BackendAuthPayload extends BackendTokenPayload {
  athlete: SessionAthlete;
}

export type BackendAuthResult<T> =
  { ok: true; value: T } | { ok: false; status: number; code: string };

export interface BackendAuth {
  login(email: string, password: string): Promise<BackendAuthResult<BackendAuthPayload>>;
  signup(input: SignupInput): Promise<BackendAuthResult<BackendAuthPayload>>;
  refresh(refreshToken: string): Promise<BackendAuthResult<BackendTokenPayload>>;
  logout(refreshToken: string): Promise<void>;
}

export interface BackendAuthDeps {
  baseUrl: string;
  fetchImpl: typeof fetch;
}

async function post<T>(
  deps: BackendAuthDeps,
  path: string,
  body: unknown,
  okStatus: number,
): Promise<BackendAuthResult<T>> {
  try {
    const response = await deps.fetchImpl(`${deps.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status !== okStatus) {
      return { ok: false, status: response.status, code: await errorCode(response) };
    }

    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false, status: 502, code: 'request_failed' };
  }
}

export function createBackendAuth(deps: BackendAuthDeps): BackendAuth {
  return {
    login: (email, password) => post(deps, '/auth/login', { email, password }, 200),
    signup: (input) => post(deps, '/auth/signup', input, 201),
    refresh: (refreshToken) => post(deps, '/auth/refresh', { refreshToken }, 200),

    async logout(refreshToken: string): Promise<void> {
      await post(deps, '/auth/logout', { refreshToken }, 204);
    },
  };
}
