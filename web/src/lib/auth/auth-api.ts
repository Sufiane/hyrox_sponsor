import { AuthApiError } from './auth-types.ts';
import type { AccessGrant, AuthGrant, SignupInput } from './auth-types.ts';
import { errorCode } from './error-code.ts';

export interface AuthApi {
  login(email: string, password: string): Promise<AuthGrant>;
  signup(input: SignupInput): Promise<AuthGrant>;
  refresh(): Promise<AccessGrant>;
  logout(): Promise<void>;
}

export interface AuthApiOptions {
  fetchImpl?: typeof fetch;
}

async function send<T>(options: AuthApiOptions, path: string, body?: unknown): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const init: RequestInit =
    body === undefined
      ? { method: 'POST', credentials: 'same-origin' }
      : {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
  let response: Response;

  try {
    response = await fetchImpl(path, init);
  } catch {
    throw new AuthApiError(0, 'request_failed');
  }

  if (!response.ok) {
    throw new AuthApiError(response.status, await errorCode(response));
  }

  return (await response.json()) as T;
}

export function createAuthApi(options: AuthApiOptions = {}): AuthApi {
  return {
    login: (email, password) => send(options, '/session/login', { email, password }),
    signup: (input) => send(options, '/session/signup', input),
    refresh: () => send(options, '/session/refresh'),

    async logout(): Promise<void> {
      try {
        await (options.fetchImpl ?? fetch)('/session/logout', {
          method: 'POST',
          credentials: 'same-origin',
        });
      } catch {
        return;
      }
    },
  };
}
