import { sendJson } from './api-result.ts';
import type { ApiResult } from './api-result.ts';
import type { OwnEntry, OwnResult, SubmitResultResponse } from './results-types.ts';

export interface SubmitResultInput {
  finishTimeSeconds: number;
  proofUrl?: string;
  photo?: File | null;
}

export interface ResultSubmitApi {
  submitResult(
    raceEntryId: string,
    input: SubmitResultInput,
  ): Promise<ApiResult<SubmitResultResponse>>;
  getOwnResult(raceEntryId: string): Promise<ApiResult<OwnResult>>;
  listOwnEntries(): Promise<ApiResult<{ items: OwnEntry[] }>>;
}

export function createResultSubmitApi(baseUrl: string, authedFetch: typeof fetch): ResultSubmitApi {
  const resultPath = (raceEntryId: string): string =>
    `${baseUrl}/race-entries/${encodeURIComponent(raceEntryId)}/result`;

  return {
    submitResult(raceEntryId, input): Promise<ApiResult<SubmitResultResponse>> {
      const body = new FormData();

      body.set('finishTimeSeconds', String(input.finishTimeSeconds));

      const proofUrl = input.proofUrl?.trim();

      if (proofUrl != null && proofUrl !== '') {
        body.set('proofUrl', proofUrl);
      }

      if (input.photo != null) {
        body.set('photo', input.photo);
      }

      return sendJson(authedFetch, resultPath(raceEntryId), { method: 'PUT', body });
    },

    getOwnResult(raceEntryId): Promise<ApiResult<OwnResult>> {
      return sendJson(authedFetch, resultPath(raceEntryId), { method: 'GET' });
    },

    listOwnEntries(): Promise<ApiResult<{ items: OwnEntry[] }>> {
      return sendJson(authedFetch, `${baseUrl}/race-entries`, { method: 'GET' });
    },
  };
}
