import { sendJson } from '../results/api-result.ts';
import type { ApiResult } from '../results/api-result.ts';

export type ConnectStatus = 'NOT_STARTED' | 'INCOMPLETE' | 'RESTRICTED' | 'READY';

export interface OnboardingLink {
  url: string;
  expiresAt: string;
}

export interface ConnectApi {
  fetchConnectStatus(): Promise<ApiResult<{ status: ConnectStatus }>>;
  requestOnboardingLink(): Promise<ApiResult<OnboardingLink>>;
}

export function createConnectApi(baseUrl: string, authedFetch: typeof fetch): ConnectApi {
  return {
    fetchConnectStatus(): Promise<ApiResult<{ status: ConnectStatus }>> {
      return sendJson(authedFetch, `${baseUrl}/athletes/me/connect/status`, { method: 'GET' });
    },

    requestOnboardingLink(): Promise<ApiResult<OnboardingLink>> {
      return sendJson(authedFetch, `${baseUrl}/athletes/me/connect/onboarding-link`, {
        method: 'POST',
      });
    },
  };
}
