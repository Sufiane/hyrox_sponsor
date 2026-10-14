import { NotAuthenticatedError } from '../auth/auth-types.ts';
import { errorCode } from '../auth/error-code.ts';

export type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

export const REQUEST_FAILED: ApiResult<never> = {
  ok: false,
  status: 502,
  code: 'request_failed',
};

export async function sendJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;

  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) {
      return { ok: false, status: 401, code: 'not_authenticated' };
    }

    return REQUEST_FAILED;
  }

  if (!response.ok) {
    return { ok: false, status: response.status, code: await errorCode(response) };
  }

  try {
    return { ok: true, value: (await response.json()) as T };
  } catch {
    return REQUEST_FAILED;
  }
}
