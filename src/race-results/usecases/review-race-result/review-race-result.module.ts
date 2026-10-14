import { Module } from '@nestjs/common';
import { ReviewRaceResultUsecase } from './review-race-result.usecase';
import { ReviewRaceResultUsecaseDb } from './review-race-result.usecase.db';

@Module({
  providers: [ReviewRaceResultUsecase, ReviewRaceResultUsecaseDb],
  exports: [ReviewRaceResultUsecase],
})
export class ReviewRaceResultModule {}
