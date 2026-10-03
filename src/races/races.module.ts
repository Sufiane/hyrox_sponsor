import { Module } from '@nestjs/common';
import { RaceDb } from './race.db';
import { RaceService } from './race.service';
import { RaceEntryController } from './race-entry.controller';
import { RaceEntryDb } from './race-entry.db';
import { RaceEntryService } from './race-entry.service';
import { LogRaceModule } from './usecases/log-race/log-race.module';

@Module({
  imports: [LogRaceModule],
  controllers: [RaceEntryController],
  providers: [RaceService, RaceDb, RaceEntryService, RaceEntryDb],
  exports: [RaceService, RaceEntryService],
})
export class RacesModule {}
