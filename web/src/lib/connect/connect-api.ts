import { sendJson } from '../results/api-result.ts';
import type { ApiResult } from '../results/api-result.ts';

export type ConnectStatus = 'NOT_STARTED' | 'INCOMPLETE' | 'RESTRICTED' | 'READY';

export interface ConnectStatusResponse {
  status: ConnectStatus;
  requirementsDue: string[] | null;
}

export interface OnboardingLink {
  url: string;
  expiresAt: string;
}

export interface ConnectApi {
  fetchConnectStatus(): Promise<ApiResult<ConnectStatusResponse>>;
  requestOnboardingLink(): Promise<ApiResult<OnboardingLink>>;
}

function parseRequirementsDue(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value;
  }

  return null;
}

export function createConnectApi(baseUrl: string, authedFetch: typeof fetch): ConnectApi {
  return {
    async fetchConnectStatus(): Promise<ApiResult<ConnectStatusResponse>> {
      const result = await sendJson<{ status: ConnectStatus; requirementsDue?: unknown }>(
        authedFetch,
        `${baseUrl}/athletes/me/connect/status`,
        { method: 'GET' },
      );

      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        value: { status: result.value.status, requirementsDue: parseRequirementsDue(result.value.requirementsDue) },
      };
    },

    requestOnboardingLink(): Promise<ApiResult<OnboardingLink>> {
      return sendJson(authedFetch, `${baseUrl}/athletes/me/connect/onboarding-link`, {
        method: 'POST',
      });
    },
  };
}
