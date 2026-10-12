import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/domain-error';
import type { RaceEntryId } from '../../../common/ids';
import { RaceEntryService } from '../../../races/race-entry.service';
import { ZoneFloorPriceService } from '../../../zones/zone-floor-price.service';
import { auctionWindow } from '../../auction-window';
import { processInBatches } from '../../process-in-batches';
import {
  MaterializeAuctionsUsecaseDb,
  type MaterializeCandidate,
  type NewAuctionRow,
} from './materialize-auctions.usecase.db';

@Injectable()
export class MaterializeAuctionsUsecase {
  private readonly logger = new Logger(MaterializeAuctionsUsecase.name);

  constructor(
    private readonly db: MaterializeAuctionsUsecaseDb,
    private readonly raceEntries: RaceEntryService,
    private readonly floorPrices: ZoneFloorPriceService,
  ) {}

  async execute(now: Date): Promise<number> {
    let created = 0;

    await processInBatches<MaterializeCandidate, RaceEntryId>(
      (after, limit) => this.db.findCandidates(now, after, limit),
      (candidate) => candidate.raceEntryId,
      async (page) => {
        for (const candidate of page) {
          created += await this.materialize(candidate, now);
        }
      },
    );

    return created;
  }

  private async materialize(candidate: MaterializeCandidate, now: Date): Promise<number> {
    if (candidate.timezone === null) {
      this.logger.warn(`Race entry ${candidate.raceEntryId} skipped: iana_timezone_invalid`);

      return 0;
    }

    const window = auctionWindow(candidate.raceLocalDate, candidate.timezone);

    if (window.closeAt.getTime() <= now.getTime()) {
      return 0;
    }

    try {
      await this.raceEntries.assertVerified(candidate.raceEntryId);

      const prices = await this.floorPrices.listForAthlete(candidate.athleteId);
      const rows: NewAuctionRow[] = prices.map((price) => ({
        raceEntryId: candidate.raceEntryId,
        zone: price.zone,
        floorPriceCents: price.floorPriceCents,
        openAt: window.openAt,
        closeAt: window.closeAt,
      }));

      return await this.db.createScheduled(rows);
    } catch (error) {
      return this.skip(candidate, error);
    }
  }

  private skip(candidate: MaterializeCandidate, error: unknown): number {
    if (error instanceof ConflictError || error instanceof NotFoundError) {
      this.logger.warn(`Race entry ${candidate.raceEntryId} skipped: ${error.code}`);

      return 0;
    }

    this.logger.error(
      `Race entry ${candidate.raceEntryId} failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    return 0;
  }
}
