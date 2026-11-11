import { createAuthedFetch } from '../auth/authed-fetch.ts';
import { session } from '../auth/session.svelte.ts';
import { createConnectApi } from './connect-api.ts';
import type { ConnectApi } from './connect-api.ts';

export function authedConnectApi(): ConnectApi {
  return createConnectApi(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000', createAuthedFetch({ session }));
}
