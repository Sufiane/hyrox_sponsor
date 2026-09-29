import { Injectable } from '@nestjs/common';
import type { AthleteId, RaceId } from '../common/index.js';
import { RaceEntryDb } from './race-entry.db.js';

const VERIFICATION_STATUS = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

@Injectable()
export class RaceEntryService {
  constructor(private readonly db: RaceEntryDb) {}

  async isVerified(athleteId: AthleteId, raceId: RaceId): Promise<boolean> {
    const entry = await this.db.findByAthleteAndRace(athleteId, raceId);

    if (!entry) {
      return false;
    }

    return entry.verificationStatus === VERIFICATION_STATUS.VERIFIED;
  }
}
