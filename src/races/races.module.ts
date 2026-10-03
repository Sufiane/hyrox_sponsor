import { Module } from '@nestjs/common';
import { RaceDb } from './race.db';
import { RaceService } from './race.service';
import { RaceEntryDb } from './race-entry.db';
import { RaceEntryService } from './race-entry.service';

@Module({
  providers: [RaceService, RaceDb, RaceEntryService, RaceEntryDb],
  exports: [RaceService, RaceEntryService],
})
export class RacesModule {}
