import { Module } from '@nestjs/common';
import { LogRaceUsecase } from './log-race.usecase';
import { LogRaceUsecaseDb } from './log-race.usecase.db';

@Module({
  providers: [LogRaceUsecase, LogRaceUsecaseDb],
  exports: [LogRaceUsecase],
})
export class LogRaceModule {}
