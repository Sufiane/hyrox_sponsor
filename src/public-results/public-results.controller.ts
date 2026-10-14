import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ListRacesQueryDto } from './dto/list-races-query.dto';
import { ListResultsQueryDto } from './dto/list-results-query.dto';
import { PublicRaceParamsDto } from './dto/public-race-params.dto';
import {
  PublicResultsService,
  type PublicRaceDetail,
  type PublicRaceList,
  type PublicResultPage,
} from './public-results.service';

const PUBLIC_CACHE_CONTROL = 'public, max-age=60';

@Controller('public/races')
export class PublicResultsController {
  constructor(private readonly service: PublicResultsService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  listRaces(@Query() query: ListRacesQueryDto): Promise<PublicRaceList> {
    return this.service.listRaces(query.limit, query.cursor ?? null);
  }

  @Get(':raceId')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  getRace(@Param() params: PublicRaceParamsDto): Promise<PublicRaceDetail> {
    return this.service.getRace(params.raceId);
  }

  @Get(':raceId/results')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  listResults(@Param() params: PublicRaceParamsDto, @Query() query: ListResultsQueryDto): Promise<PublicResultPage> {
    return this.service.listResults(params.raceId, query.division, query.limit, query.offset);
  }
}
