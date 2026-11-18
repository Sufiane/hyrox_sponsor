import { sendJson } from '../results/api-result.ts';
import type { ApiResult } from '../results/api-result.ts';

export interface SetupIntentResponse {
  clientSecret: string;
  bidderToken: string;
  bidderTokenExpiresAt: string;
}

export interface BidderApi {
  createSetupIntent(email: string, token: string | null): Promise<ApiResult<SetupIntentResponse>>;
}

export function createBidderApi(baseUrl: string, fetchImpl: typeof fetch): BidderApi {
  return {
    createSetupIntent(email: string, token: string | null): Promise<ApiResult<SetupIntentResponse>> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };

      if (token != null) {
        headers['x-bidder-token'] = token;
      }

      return sendJson(fetchImpl, `${baseUrl}/bidders/setup-intents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email }),
      });
    },
  };
}
