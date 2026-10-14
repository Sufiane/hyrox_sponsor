import { Module } from '@nestjs/common';
import { StorageModule } from '../../../storage/storage.module';
import { SubmitRaceResultUsecase } from './submit-race-result.usecase';
import { SubmitRaceResultUsecaseDb } from './submit-race-result.usecase.db';

@Module({
  imports: [StorageModule],
  providers: [SubmitRaceResultUsecase, SubmitRaceResultUsecaseDb],
  exports: [SubmitRaceResultUsecase],
})
export class SubmitRaceResultModule {}
