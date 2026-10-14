import { createResultsApi } from './results-api.ts';
import type { ResultsApi } from './results-api.ts';

export function publicResultsApi(fetchImpl: typeof fetch): ResultsApi {
  return createResultsApi({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
    fetchImpl,
  });
}
