import { Injectable } from '@nestjs/common';
import { RaceEntryDb } from './race-entry.db.js';

@Injectable()
export class RaceEntryService {
  constructor(private readonly db: RaceEntryDb) {}

  async isVerified(athleteId: string, raceId: string): Promise<boolean> {
    const entry = await this.db.findByAthleteAndRace(athleteId, raceId);

    if (!entry) {
      return false;
    }

    return entry.verificationStatus === 'VERIFIED';
  }
}
