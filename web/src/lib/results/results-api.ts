import { sendJson } from './api-result.ts';
import type { ApiResult } from './api-result.ts';
import { RESULTS_PAGE_SIZE } from './results-types.ts';
import type { PublicRaceDetail, PublicRaceList, PublicResultPage } from './results-types.ts';

export interface ResultsApiOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface ListResultsParams {
  division: string;
  page: number;
}

export interface ResultsApi {
  listRaces(cursor?: string): Promise<ApiResult<PublicRaceList>>;
  getRace(raceId: string): Promise<ApiResult<PublicRaceDetail>>;
  listResults(raceId: string, params: ListResultsParams): Promise<ApiResult<PublicResultPage>>;
}

export function createResultsApi(options: ResultsApiOptions): ResultsApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const get = <T>(path: string): Promise<ApiResult<T>> =>
    sendJson<T>(fetchImpl, `${options.baseUrl}${path}`, { method: 'GET' });

  return {
    listRaces(cursor?: string): Promise<ApiResult<PublicRaceList>> {
      const query = cursor == null ? '' : `?cursor=${encodeURIComponent(cursor)}`;

      return get(`/public/races${query}`);
    },

    getRace(raceId: string): Promise<ApiResult<PublicRaceDetail>> {
      return get(`/public/races/${encodeURIComponent(raceId)}`);
    },

    listResults(raceId: string, params: ListResultsParams): Promise<ApiResult<PublicResultPage>> {
      const query = new URLSearchParams({
        division: params.division,
        limit: String(RESULTS_PAGE_SIZE),
        offset: String((params.page - 1) * RESULTS_PAGE_SIZE),
      });

      return get(`/public/races/${encodeURIComponent(raceId)}/results?${query}`);
    },
  };
}
