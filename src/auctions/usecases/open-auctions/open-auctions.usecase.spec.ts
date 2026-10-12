import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ConflictError } from '../../../common/domain-error';
import type { AthleteId, AuctionId, RaceEntryId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { RaceEntryService } from '../../../races/race-entry.service';
import { ZoneFloorPriceService } from '../../../zones/zone-floor-price.service';
import { ZONE_ORDER } from '../../../zones/zone-order';
import { BATCH_SIZE } from '../../process-in-batches';
import { OpenAuctionsUsecase } from './open-auctions.usecase';
import { OpenAuctionsUsecaseDb, type DueToOpen } from './open-auctions.usecase.db';

const now = new Date('2026-11-05T12:00:00Z');

function due(auctionId: string, raceEntryId: string, athleteId: string, zone: DueToOpen['zone']): DueToOpen {
  return {
    auctionId: auctionId as AuctionId,
    raceEntryId: raceEntryId as RaceEntryId,
    athleteId: athleteId as AthleteId,
    zone,
  };
}

function pricesFor(saved: Partial<Record<DueToOpen['zone'], number>>): ReturnType<ZoneFloorPriceService['listForAthlete']> {
  return Promise.resolve(
    ZONE_ORDER.map((zone) => ({
      zone,
      floorPriceCents: cents(saved[zone] ?? 1000),
      isDefault: saved[zone] === undefined,
    })),
  );
}

describe('OpenAuctionsUsecase', () => {
  let db: DeepMockProxy<OpenAuctionsUsecaseDb>;
  let entries: DeepMockProxy<RaceEntryService>;
  let floors: DeepMockProxy<ZoneFloorPriceService>;
  let usecase: OpenAuctionsUsecase;
  let warn: MockInstance;
  let error: MockInstance;

  beforeEach(async () => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    db = mockDeep<OpenAuctionsUsecaseDb>();
    entries = mockDeep<RaceEntryService>();
    floors = mockDeep<ZoneFloorPriceService>();
    entries.assertVerified.mockResolvedValue(undefined);
    db.markOpen.mockResolvedValue(1);
    floors.listForAthlete.mockImplementation(() => pricesFor({ LEFT_PEC: 2500 }));
    const moduleRef = await Test.createTestingModule({
      providers: [
        OpenAuctionsUsecase,
        { provide: OpenAuctionsUsecaseDb, useValue: db },
        { provide: RaceEntryService, useValue: entries },
        { provide: ZoneFloorPriceService, useValue: floors },
      ],
    }).compile();
    usecase = moduleRef.get(OpenAuctionsUsecase);
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  describe('when two due auctions belong to the same entry and athlete', () => {
    beforeEach(() => {
      db.findDue.mockResolvedValueOnce([
        due('auction-1', 'entry-1', 'athlete-1', 'LEFT_PEC'),
        due('auction-2', 'entry-1', 'athlete-1', 'RIGHT_PEC'),
      ]);
    });

    it('opens both and returns the count', async () => {
      const opened = await usecase.execute(now);

      expect(opened).toBe(2);
    });

    it('snapshots each zone floor', async () => {
      await usecase.execute(now);

      expect(db.markOpen).toHaveBeenCalledWith('auction-1', cents(2500), now);
      expect(db.markOpen).toHaveBeenCalledWith('auction-2', cents(1000), now);
    });

    it('verifies the entry once', async () => {
      await usecase.execute(now);

      expect(entries.assertVerified).toHaveBeenCalledOnce();
    });

    it('reads the athlete floors once', async () => {
      await usecase.execute(now);

      expect(floors.listForAthlete).toHaveBeenCalledOnce();
    });
  });

  describe('when the compare-and-set matches no row', () => {
    beforeEach(() => {
      db.findDue.mockResolvedValueOnce([due('auction-1', 'entry-1', 'athlete-1', 'LEFT_PEC')]);
      db.markOpen.mockResolvedValue(0);
    });

    it('does not count the auction', async () => {
      const opened = await usecase.execute(now);

      expect(opened).toBe(0);
    });
  });

  describe('when the verification gate rejects an entry', () => {
    beforeEach(() => {
      db.findDue.mockResolvedValueOnce([
        due('auction-1', 'entry-1', 'athlete-1', 'LEFT_PEC'),
        due('auction-2', 'entry-2', 'athlete-2', 'LEFT_PEC'),
      ]);
      entries.assertVerified
        .mockRejectedValueOnce(new ConflictError('race_entry_not_verified'))
        .mockResolvedValueOnce(undefined);
    });

    it('skips that entry and opens the others', async () => {
      const opened = await usecase.execute(now);

      expect(opened).toBe(1);
      expect(db.markOpen).toHaveBeenCalledOnce();
      expect(db.markOpen).toHaveBeenCalledWith('auction-2', cents(2500), now);
    });

    it('logs the skipped entry', async () => {
      await usecase.execute(now);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('entry-1'));
    });
  });

  describe('when opening one auction throws', () => {
    beforeEach(() => {
      db.findDue.mockResolvedValueOnce([
        due('auction-1', 'entry-1', 'athlete-1', 'LEFT_PEC'),
        due('auction-2', 'entry-1', 'athlete-1', 'RIGHT_PEC'),
      ]);
      db.markOpen.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(1);
    });

    it('still opens the next auction', async () => {
      const opened = await usecase.execute(now);

      expect(opened).toBe(1);
    });

    it('logs the failure', async () => {
      await usecase.execute(now);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });

  describe('when the first page is full', () => {
    beforeEach(() => {
      const fullPage = Array.from({ length: BATCH_SIZE }, (_, index) =>
        due(`auction-${index}`, 'entry-1', 'athlete-1', 'LEFT_PEC'),
      );
      db.findDue.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([]);
    });

    it('fetches the next page after the last auction id', async () => {
      await usecase.execute(now);

      expect(db.findDue).toHaveBeenNthCalledWith(2, now, `auction-${BATCH_SIZE - 1}`, BATCH_SIZE);
    });
  });
});
