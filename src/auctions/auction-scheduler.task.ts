import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { EnvironmentVariables } from '../config/env.validation';
import { AuctionService } from './auction.service';

const ONE_MINUTE_MILLIS = 60_000;
const TICK_INTERVAL_MILLIS = ONE_MINUTE_MILLIS;

@Injectable()
export class AuctionSchedulerTask {
  private readonly logger = new Logger(AuctionSchedulerTask.name);
  private running = false;

  constructor(
    private readonly auctions: AuctionService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Interval(TICK_INTERVAL_MILLIS)
  async tick(): Promise<void> {
    if (!this.config.get('AUCTION_SCHEDULER_ENABLED', { infer: true }) || this.running) {
      return;
    }

    this.running = true;

    try {
      const result = await this.auctions.runLifecycleTick(new Date());
      const changed = Object.values(result).some((count) => count > 0);

      if (changed) {
        this.logger.log(
          `Auction tick: materialized=${result.materialized} opened=${result.opened} closedWithWinner=${result.closedWithWinner} closedNoSale=${result.closedNoSale}`,
        );
      }
    } catch (error) {
      this.logger.error(`Auction tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
