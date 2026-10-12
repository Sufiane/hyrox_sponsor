import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuctionId } from '../common/ids';
import { AuctionDb } from './auction.db';
import { CloseAuctionsUsecase } from './usecases/close-auctions/close-auctions.usecase';
import { MaterializeAuctionsUsecase } from './usecases/materialize-auctions/materialize-auctions.usecase';
import { OpenAuctionsUsecase } from './usecases/open-auctions/open-auctions.usecase';

export type LifecycleTickResult = {
  materialized: number;
  opened: number;
  closedWithWinner: number;
  closedNoSale: number;
};

type AuctionRecord = NonNullable<Awaited<ReturnType<AuctionDb['findById']>>>;

@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    private readonly db: AuctionDb,
    private readonly materializeAuctions: MaterializeAuctionsUsecase,
    private readonly openAuctions: OpenAuctionsUsecase,
    private readonly closeAuctions: CloseAuctionsUsecase,
  ) {}

  async getById(id: AuctionId): Promise<AuctionRecord> {
    const auction = await this.db.findById(id);

    if (!auction) {
      this.logger.warn(`Auction ${id} not found`);

      throw new NotFoundException('auction_not_found');
    }

    return auction;
  }

  async runLifecycleTick(now: Date): Promise<LifecycleTickResult> {
    const [creation, closed] = await Promise.all([
      this.materializeThenOpen(now),
      this.guarded('close', () => this.closeAuctions.execute(now), { won: 0, noSale: 0 }),
    ]);

    return {
      materialized: creation.materialized,
      opened: creation.opened,
      closedWithWinner: closed.won,
      closedNoSale: closed.noSale,
    };
  }

  private async materializeThenOpen(now: Date): Promise<{ materialized: number; opened: number }> {
    const materialized = await this.guarded('materialize', () => this.materializeAuctions.execute(now), 0);
    const opened = await this.guarded('open', () => this.openAuctions.execute(now), 0);

    return { materialized, opened };
  }

  private async guarded<Result>(phase: string, run: () => Promise<Result>, fallback: Result): Promise<Result> {
    try {
      return await run();
    } catch (error) {
      this.logger.error(
        `Auction ${phase} phase failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return fallback;
    }
  }
}
