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
  login(
    email: string,
    password: string,
    clientIp: string | null,
  ): Promise<BackendAuthResult<BackendAuthPayload>>;
  signup(
    input: SignupInput,
    clientIp: string | null,
  ): Promise<BackendAuthResult<BackendAuthPayload>>;
  refresh(
    refreshToken: string,
    clientIp: string | null,
  ): Promise<BackendAuthResult<BackendTokenPayload>>;
  logout(refreshToken: string, clientIp: string | null): Promise<void>;
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
  clientIp: string | null,
): Promise<BackendAuthResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (clientIp != null) {
    headers['X-Forwarded-For'] = clientIp;
  }

  try {
    const response = await deps.fetchImpl(`${deps.baseUrl}${path}`, {
      method: 'POST',
      headers,
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
    login: (email, password, clientIp) =>
      post(deps, '/auth/login', { email, password }, 200, clientIp),
    signup: (input, clientIp) => post(deps, '/auth/signup', input, 201, clientIp),
    refresh: (refreshToken, clientIp) =>
      post(deps, '/auth/refresh', { refreshToken }, 200, clientIp),

    async logout(refreshToken: string, clientIp: string | null): Promise<void> {
      await post(deps, '/auth/logout', { refreshToken }, 204, clientIp);
    },
  };
}
