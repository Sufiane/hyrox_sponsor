import { Injectable, Logger } from '@nestjs/common';
import type { AuctionId } from '../../../common/ids';
import { proofDeadline } from '../../auction-window';
import { processInBatches } from '../../process-in-batches';
import { CloseAuctionsUsecaseDb, type DueToClose } from './close-auctions.usecase.db';

export type CloseTotals = { won: number; noSale: number };

@Injectable()
export class CloseAuctionsUsecase {
  private readonly logger = new Logger(CloseAuctionsUsecase.name);

  constructor(private readonly db: CloseAuctionsUsecaseDb) {}

  async execute(now: Date): Promise<CloseTotals> {
    const totals: CloseTotals = { won: 0, noSale: 0 };

    await processInBatches<DueToClose, AuctionId>(
      (after, limit) => this.db.findDue(now, after, limit),
      (due) => due.auctionId,
      async (page) => {
        for (const due of page) {
          await this.close(due, now, totals);
        }
      },
    );

    return totals;
  }

  private async close(due: DueToClose, now: Date, totals: CloseTotals): Promise<void> {
    try {
      const result = await this.db.closeAuction(due.auctionId, now, proofDeadline(due.raceDate));

      if (result === 'won') {
        totals.won += 1;
      }

      if (result === 'no_sale') {
        totals.noSale += 1;
      }
    } catch (error) {
      this.logger.error(
        `Auction ${due.auctionId} failed to close: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
