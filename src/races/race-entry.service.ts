import { Injectable } from '@nestjs/common';
import type { AthleteId, RaceId } from '../common/ids';
import { RaceEntryDb } from './race-entry.db';
import type { LogRaceInput } from './usecases/log-race/log-race-input';
import { LogRaceUsecase, type LogRaceResult } from './usecases/log-race/log-race.usecase';

const VERIFICATION_STATUS = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

@Injectable()
export class RaceEntryService {
  constructor(
    private readonly db: RaceEntryDb,
    private readonly logRaceUsecase: LogRaceUsecase,
  ) {}

  logRace(athleteId: AthleteId, input: LogRaceInput): Promise<LogRaceResult> {
    return this.logRaceUsecase.execute(athleteId, input);
  }

  async isVerified(athleteId: AthleteId, raceId: RaceId): Promise<boolean> {
    const entry = await this.db.findByAthleteAndRace(athleteId, raceId);

    if (!entry) {
      return false;
    }

    return entry.verificationStatus === VERIFICATION_STATUS.VERIFIED;
  }
}
