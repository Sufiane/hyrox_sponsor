import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { StorageModule } from '../storage/storage.module';
import { RaceResultController } from './race-result.controller';
import { RaceResultDb } from './race-result.db';
import { RaceResultService } from './race-result.service';
import { StaffRaceResultReviewController } from './staff-race-result-review.controller';
import { ReviewRaceResultModule } from './usecases/review-race-result/review-race-result.module';
import { SubmitRaceResultModule } from './usecases/submit-race-result/submit-race-result.module';

@Module({
  imports: [AuthModule, StaffAuthModule, StorageModule, SubmitRaceResultModule, ReviewRaceResultModule],
  controllers: [RaceResultController, StaffRaceResultReviewController],
  providers: [RaceResultService, RaceResultDb],
})
export class RaceResultsModule {}
