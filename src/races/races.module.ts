import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { RaceDb } from './race.db';
import { RaceService } from './race.service';
import { RaceEntryController } from './race-entry.controller';
import { RaceEntryDb } from './race-entry.db';
import { RaceEntryService } from './race-entry.service';
import { RaceEntryVerificationController } from './race-entry-verification.controller';
import { LogRaceModule } from './usecases/log-race/log-race.module';
import { ReviewVerificationModule } from './usecases/review-verification/review-verification.module';
import { SubmitVerificationDocumentModule } from './usecases/submit-verification-document/submit-verification-document.module';

@Module({
  imports: [
    AuthModule,
    LogRaceModule,
    StorageModule,
    SubmitVerificationDocumentModule,
    ReviewVerificationModule,
  ],
  controllers: [RaceEntryController, RaceEntryVerificationController],
  providers: [RaceService, RaceDb, RaceEntryService, RaceEntryDb],
  exports: [RaceService, RaceEntryService],
})
export class RacesModule {}
