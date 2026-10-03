import { Body, Controller, Param, Post } from '@nestjs/common';
import { AthleteParamsDto } from '../athletes/dto/athlete-params.dto';
import { LogRaceDto } from './dto/log-race.dto';
import { RaceEntryService } from './race-entry.service';
import type { LogRaceResult } from './usecases/log-race/log-race.usecase';

@Controller('athletes/:athleteId/race-entries')
export class RaceEntryController {
  constructor(private readonly service: RaceEntryService) {}

  @Post()
  logRace(@Param() params: AthleteParamsDto, @Body() body: LogRaceDto): Promise<LogRaceResult> {
    return this.service.logRace(params.athleteId, {
      name: body.name,
      location: body.location,
      date: body.date,
      timezone: body.timezone,
      division: body.division,
    });
  }
}
