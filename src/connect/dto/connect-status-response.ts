import type { ConnectStatus } from '../connect-status';

export type ConnectStatusResponse = {
  status: ConnectStatus;
  requirementsDue: string[] | null;
};
