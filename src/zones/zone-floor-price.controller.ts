import { Body, Controller, Get, Param, Put, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CurrentAthleteId } from '../auth/current-athlete-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AthleteId } from '../common/ids';
import { SetFloorPriceDto } from './dto/set-floor-price.dto';
import { ZoneParamDto } from './dto/zone-param.dto';
import { ZoneFloorPriceService, type ZoneFloorPriceView } from './zone-floor-price.service';

export type ListFloorPricesResponse = {
  prices: ZoneFloorPriceView[];
};

@Controller('zone-floor-prices')
@UseGuards(JwtAuthGuard)
export class ZoneFloorPriceController {
  constructor(private readonly service: ZoneFloorPriceService) {}

  @Get()
  async list(@CurrentAthleteId() currentAthleteId: AthleteId | undefined): Promise<ListFloorPricesResponse> {
    const prices = await this.service.listForAthlete(this.requireAthleteId(currentAthleteId));

    return { prices };
  }

  @Put(':zone')
  async set(
    @CurrentAthleteId() currentAthleteId: AthleteId | undefined,
    @Param() params: ZoneParamDto,
    @Body() body: SetFloorPriceDto,
  ): Promise<ZoneFloorPriceView> {
    return this.service.setFloorPrice(this.requireAthleteId(currentAthleteId), params.zone, body.floorPriceCents);
  }

  private requireAthleteId(athleteId: AthleteId | undefined): AthleteId {
    if (athleteId == null) {
      throw new UnauthorizedException('invalid_token');
    }

    return athleteId;
  }
}
