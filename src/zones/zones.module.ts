import { Module } from '@nestjs/common';
import { ZoneFloorPriceDb } from './zone-floor-price.db';
import { ZoneFloorPriceService } from './zone-floor-price.service';

@Module({
  providers: [ZoneFloorPriceService, ZoneFloorPriceDb],
  exports: [ZoneFloorPriceService],
})
export class ZonesModule {}
