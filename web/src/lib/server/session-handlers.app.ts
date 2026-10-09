import { dev } from '$app/env';
import { createBackendAuth } from './backend-auth.ts';
import { createSessionHandlers } from './session-handlers.ts';

export const sessionHandlers = createSessionHandlers({
  backend: createBackendAuth({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
    fetchImpl: fetch,
  }),
  secure: !dev,
  maxAgeSeconds: 2_592_000,
});
