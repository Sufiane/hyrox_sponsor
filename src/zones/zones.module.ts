import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ZoneFloorPriceController } from './zone-floor-price.controller';
import { ZoneFloorPriceDb } from './zone-floor-price.db';
import { ZoneFloorPriceService } from './zone-floor-price.service';

@Module({
  imports: [AuthModule],
  controllers: [ZoneFloorPriceController],
  providers: [ZoneFloorPriceService, ZoneFloorPriceDb],
  exports: [ZoneFloorPriceService],
})
export class ZonesModule {}
