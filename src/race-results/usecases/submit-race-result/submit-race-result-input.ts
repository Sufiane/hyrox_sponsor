import type { AthleteId, RaceEntryId } from '../../../common/ids';
import type { Seconds } from '../../../common/seconds';

export type SubmitRaceResultInput = {
  athleteId: AthleteId;
  raceEntryId: RaceEntryId;
  finishTimeSeconds: Seconds;
  proofUrl: string | null;
  photo: Buffer | null;
};

export type SubmitRaceResultOutput = {
  status: 'PENDING';
  submittedAt: Date;
  publicVisible: boolean;
};
