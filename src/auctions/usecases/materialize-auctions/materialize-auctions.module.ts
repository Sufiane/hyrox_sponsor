import { Module } from '@nestjs/common';
import { RacesModule } from '../../../races/races.module';
import { ZonesModule } from '../../../zones/zones.module';
import { MaterializeAuctionsUsecase } from './materialize-auctions.usecase';
import { MaterializeAuctionsUsecaseDb } from './materialize-auctions.usecase.db';

@Module({
  imports: [RacesModule, ZonesModule],
  providers: [MaterializeAuctionsUsecase, MaterializeAuctionsUsecaseDb],
  exports: [MaterializeAuctionsUsecase],
})
export class MaterializeAuctionsModule {}
