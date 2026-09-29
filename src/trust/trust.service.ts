import { Injectable } from '@nestjs/common';
import { StrikeDb } from './strike.db.js';
import { TrustScoreEventDb } from './trust-score-event.db.js';

type TrustScoreEventRecord = Awaited<
  ReturnType<TrustScoreEventDb['findByAthlete']>
>[number];

@Injectable()
export class TrustService {
  constructor(
    private readonly strikeDb: StrikeDb,
    private readonly trustScoreEventDb: TrustScoreEventDb,
  ) {}

  async getActiveStrikeCount(athleteId: string): Promise<number> {
    return this.strikeDb.countActiveByAthlete(athleteId);
  }

  getScoreHistory(athleteId: string): Promise<TrustScoreEventRecord[]> {
    return this.trustScoreEventDb.findByAthlete(athleteId);
  }
}
