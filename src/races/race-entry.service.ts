import { Injectable } from '@nestjs/common';
import { RaceEntryDb } from './race-entry.db.js';

type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

@Injectable()
export class RaceEntryService {
  constructor(private readonly db: RaceEntryDb) {}

  async isVerified(athleteId: string, raceId: string): Promise<boolean> {
    const entry = await this.db.findByAthleteAndRace(athleteId, raceId);

    if (!entry) {
      return false;
    }

    const verificationStatus = entry.verificationStatus as VerificationStatus;

    return verificationStatus === 'VERIFIED';
  }
}
