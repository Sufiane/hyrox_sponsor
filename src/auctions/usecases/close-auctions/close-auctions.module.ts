import { Module } from '@nestjs/common';
import { CloseAuctionsUsecase } from './close-auctions.usecase';
import { CloseAuctionsUsecaseDb } from './close-auctions.usecase.db';

@Module({
  providers: [CloseAuctionsUsecase, CloseAuctionsUsecaseDb],
  exports: [CloseAuctionsUsecase],
})
export class CloseAuctionsModule {}
