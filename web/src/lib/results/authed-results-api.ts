import { createAuthedFetch } from '../auth/authed-fetch.ts';
import { session } from '../auth/session.svelte.ts';
import { createResultSubmitApi } from './result-submit-api.ts';
import type { ResultSubmitApi } from './result-submit-api.ts';

export function authedResultSubmitApi(): ResultSubmitApi {
  return createResultSubmitApi(
    import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
    createAuthedFetch({ session }),
  );
}
