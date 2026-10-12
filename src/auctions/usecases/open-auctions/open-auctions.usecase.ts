import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/domain-error';
import type { AthleteId, AuctionId, RaceEntryId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { RaceEntryService } from '../../../races/race-entry.service';
import { ZoneFloorPriceService } from '../../../zones/zone-floor-price.service';
import type { BodyZoneValue } from '../../../zones/zone-order';
import { processInBatches } from '../../process-in-batches';
import { OpenAuctionsUsecaseDb, type DueToOpen } from './open-auctions.usecase.db';

type FloorsByZone = Map<BodyZoneValue, Cents>;

@Injectable()
export class OpenAuctionsUsecase {
  private readonly logger = new Logger(OpenAuctionsUsecase.name);

  constructor(
    private readonly db: OpenAuctionsUsecaseDb,
    private readonly raceEntries: RaceEntryService,
    private readonly floorPrices: ZoneFloorPriceService,
  ) {}

  async execute(now: Date): Promise<number> {
    let opened = 0;
    const verifiedByRaceEntry = new Map<RaceEntryId, boolean>();
    const floorsByAthlete = new Map<AthleteId, FloorsByZone>();

    await processInBatches<DueToOpen, AuctionId>(
      (after, limit) => this.db.findDue(now, after, limit),
      (due) => due.auctionId,
      async (page) => {
        for (const due of page) {
          opened += await this.open(due, now, verifiedByRaceEntry, floorsByAthlete);
        }
      },
    );

    return opened;
  }

  private async open(
    due: DueToOpen,
    now: Date,
    verifiedByRaceEntry: Map<RaceEntryId, boolean>,
    floorsByAthlete: Map<AthleteId, FloorsByZone>,
  ): Promise<number> {
    try {
      if (!(await this.isRaceEntryVerified(due.raceEntryId, verifiedByRaceEntry))) {
        return 0;
      }

      const floors = await this.getAthleteFloors(due.athleteId, floorsByAthlete);
      const floor = floors.get(due.zone);

      if (floor === undefined) {
        this.logger.error(`No floor price resolved for auction ${due.auctionId} zone ${due.zone}`);

        return 0;
      }

      return await this.db.markOpen(due.auctionId, floor, now);
    } catch (error) {
      this.logger.error(
        `Auction ${due.auctionId} failed to open: ${error instanceof Error ? error.message : String(error)}`,
      );

      return 0;
    }
  }

  private async isRaceEntryVerified(raceEntryId: RaceEntryId, verifiedByRaceEntry: Map<RaceEntryId, boolean>): Promise<boolean> {
    const known = verifiedByRaceEntry.get(raceEntryId);

    if (known !== undefined) {
      return known;
    }

    try {
      await this.raceEntries.assertVerified(raceEntryId);
      verifiedByRaceEntry.set(raceEntryId, true);

      return true;
    } catch (error) {
      if (error instanceof ConflictError || error instanceof NotFoundError) {
        this.logger.warn(`Race entry ${raceEntryId} not opened: ${error.code}`);
        verifiedByRaceEntry.set(raceEntryId, false);

        return false;
      }

      throw error;
    }
  }

  private async getAthleteFloors(athleteId: AthleteId, floorsByAthlete: Map<AthleteId, FloorsByZone>): Promise<FloorsByZone> {
    const known = floorsByAthlete.get(athleteId);

    if (known !== undefined) {
      return known;
    }

    const prices = await this.floorPrices.listForAthlete(athleteId);
    const floors: FloorsByZone = new Map(prices.map((price) => [price.zone, price.floorPriceCents]));

    floorsByAthlete.set(athleteId, floors);

    return floors;
  }
}
