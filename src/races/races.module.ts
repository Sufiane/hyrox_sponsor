import { Module } from '@nestjs/common';
import { RaceDb } from './race.db.js';
import { RaceService } from './race.service.js';
import { RaceEntryDb } from './race-entry.db.js';
import { RaceEntryService } from './race-entry.service.js';

@Module({
  providers: [RaceService, RaceDb, RaceEntryService, RaceEntryDb],
  exports: [RaceService, RaceEntryService],
})
export class RacesModule {}
