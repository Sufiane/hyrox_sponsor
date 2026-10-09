import { NotAuthenticatedError } from './auth-types.ts';
import type { Session } from './session.svelte.ts';

export interface AuthedFetchOptions {
  session: Pick<Session, 'getAccessToken' | 'isExpiringSoon' | 'refresh'>;
  fetchImpl?: typeof fetch;
}

export function createAuthedFetch(options: AuthedFetchOptions): typeof fetch {
  const { session } = options;

  async function ensureToken(): Promise<string> {
    if (session.getAccessToken() == null || session.isExpiringSoon()) {
      await session.refresh();
    }

    const token = session.getAccessToken();

    if (token == null) {
      throw new NotAuthenticatedError();
    }

    return token;
  }

  function send(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    token: string,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);

    headers.set('Authorization', `Bearer ${token}`);

    return (options.fetchImpl ?? fetch)(input, { ...init, headers });
  }

  // The retry reuses init, so init.body must be re-sendable (a string), not a stream.
  return async (input, init) => {
    const usedToken = await ensureToken();
    const response = await send(input, init, usedToken);

    if (response.status !== 401) {
      return response;
    }

    const rotated = session.getAccessToken();

    if ((rotated == null || rotated === usedToken) && !(await session.refresh())) {
      throw new NotAuthenticatedError();
    }

    const token = session.getAccessToken();

    if (token == null) {
      throw new NotAuthenticatedError();
    }

    return send(input, init, token);
  };
}
