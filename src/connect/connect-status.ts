import type { AthleteRow } from '../athletes/athlete.db';

export type ConnectStatus = 'NOT_STARTED' | 'INCOMPLETE' | 'RESTRICTED' | 'READY';

export type ConnectReadiness = Pick<
  AthleteRow,
  'stripeConnectAccountId' | 'stripeConnectDetailsSubmitted' | 'stripeConnectPayoutsEnabled'
>;

export function connectStatus(athlete: ConnectReadiness): ConnectStatus {
  if (athlete.stripeConnectAccountId == null) {
    return 'NOT_STARTED';
  }

  if (!athlete.stripeConnectDetailsSubmitted) {
    return 'INCOMPLETE';
  }

  if (!athlete.stripeConnectPayoutsEnabled) {
    return 'RESTRICTED';
  }

  return 'READY';
}
