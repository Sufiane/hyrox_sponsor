import { Module } from '@nestjs/common';
import { StrikeDb } from './strike.db.js';
import { TrustScoreEventDb } from './trust-score-event.db.js';
import { TrustService } from './trust.service.js';

@Module({
  providers: [TrustService, StrikeDb, TrustScoreEventDb],
  exports: [TrustService],
})
export class TrustModule {}
