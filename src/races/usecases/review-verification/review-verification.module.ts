import { Module } from '@nestjs/common';
import { ReviewVerificationUsecase } from './review-verification.usecase';
import { ReviewVerificationUsecaseDb } from './review-verification.usecase.db';

@Module({
  providers: [ReviewVerificationUsecase, ReviewVerificationUsecaseDb],
  exports: [ReviewVerificationUsecase],
})
export class ReviewVerificationModule {}
