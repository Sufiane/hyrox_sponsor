import { Module } from '@nestjs/common';
import { PlaceBidUsecase } from './place-bid.usecase';
import { PlaceBidUsecaseDb } from './place-bid.usecase.db';

@Module({
  providers: [PlaceBidUsecase, PlaceBidUsecaseDb],
  exports: [PlaceBidUsecase],
})
export class PlaceBidModule {}
