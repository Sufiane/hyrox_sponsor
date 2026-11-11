import { Module } from '@nestjs/common';
import { AthleteDb } from './athlete.db';
import { AthleteService } from './athlete.service';

@Module({
  providers: [AthleteService, AthleteDb],
  exports: [AthleteService, AthleteDb],
})
export class AthletesModule {}
