import { Module } from '@nestjs/common';
import { StrikeDb } from './strike.db';
import { TrustScoreEventDb } from './trust-score-event.db';
import { TrustService } from './trust.service';

@Module({
  providers: [TrustService, StrikeDb, TrustScoreEventDb],
  exports: [TrustService],
})
export class TrustModule {}
