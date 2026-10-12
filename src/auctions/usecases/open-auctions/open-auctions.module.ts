import { Module } from '@nestjs/common';
import { RacesModule } from '../../../races/races.module';
import { ZonesModule } from '../../../zones/zones.module';
import { OpenAuctionsUsecase } from './open-auctions.usecase';
import { OpenAuctionsUsecaseDb } from './open-auctions.usecase.db';

@Module({
  imports: [RacesModule, ZonesModule],
  providers: [OpenAuctionsUsecase, OpenAuctionsUsecaseDb],
  exports: [OpenAuctionsUsecase],
})
export class OpenAuctionsModule {}
