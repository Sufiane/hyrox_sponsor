import { Module } from '@nestjs/common';
import { ZoneFloorPriceDb } from './zone-floor-price.db.js';
import { ZoneFloorPriceService } from './zone-floor-price.service.js';

@Module({
  providers: [ZoneFloorPriceService, ZoneFloorPriceDb],
  exports: [ZoneFloorPriceService],
})
export class ZonesModule {}
