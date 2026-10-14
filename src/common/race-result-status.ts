export const RACE_RESULT_STATUS = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

export type RaceResultStatusCode = (typeof RACE_RESULT_STATUS)[keyof typeof RACE_RESULT_STATUS];
