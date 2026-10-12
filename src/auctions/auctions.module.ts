import { Module } from '@nestjs/common';
import { AuctionDb } from './auction.db';
import { AuctionSchedulerTask } from './auction-scheduler.task';
import { AuctionService } from './auction.service';
import { CloseAuctionsModule } from './usecases/close-auctions/close-auctions.module';
import { MaterializeAuctionsModule } from './usecases/materialize-auctions/materialize-auctions.module';
import { OpenAuctionsModule } from './usecases/open-auctions/open-auctions.module';

@Module({
  imports: [MaterializeAuctionsModule, OpenAuctionsModule, CloseAuctionsModule],
  providers: [AuctionService, AuctionDb, AuctionSchedulerTask],
  exports: [AuctionService],
})
export class AuctionsModule {}
