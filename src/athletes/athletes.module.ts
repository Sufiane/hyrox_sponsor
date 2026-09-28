import { Module } from '@nestjs/common';
import { AthleteDb } from './athlete.db.js';
import { AthleteService } from './athlete.service.js';

@Module({
  providers: [AthleteService, AthleteDb],
  exports: [AthleteService],
})
export class AthletesModule {}
