const GENERIC_CODE = 'request_failed';

export async function errorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown }).message;

    return typeof message === 'string' ? message : GENERIC_CODE;
  } catch {
    return GENERIC_CODE;
  }
}
