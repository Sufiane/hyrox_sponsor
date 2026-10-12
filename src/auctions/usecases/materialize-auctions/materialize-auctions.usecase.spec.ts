import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ConflictError } from '../../../common/domain-error';
import type { IanaTimezone } from '../../../common/iana-timezone';
import type { AthleteId, RaceEntryId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { RaceEntryService } from '../../../races/race-entry.service';
import { ZoneFloorPriceService } from '../../../zones/zone-floor-price.service';
import { ZONE_ORDER } from '../../../zones/zone-order';
import { MaterializeAuctionsUsecase } from './materialize-auctions.usecase';
import { MaterializeAuctionsUsecaseDb, type MaterializeCandidate } from './materialize-auctions.usecase.db';

const now = new Date('2026-10-20T12:00:00Z');
const candidate: MaterializeCandidate = {
  raceEntryId: 'entry-1' as RaceEntryId,
  athleteId: 'athlete-1' as AthleteId,
  raceLocalDate: new Date('2026-11-14T00:00:00Z'),
  timezone: 'America/Chicago' as IanaTimezone,
};

describe('MaterializeAuctionsUsecase', () => {
  let db: DeepMockProxy<MaterializeAuctionsUsecaseDb>;
  let entries: DeepMockProxy<RaceEntryService>;
  let floors: DeepMockProxy<ZoneFloorPriceService>;
  let usecase: MaterializeAuctionsUsecase;
  let warn: MockInstance;
  let error: MockInstance;

  beforeEach(async () => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    db = mockDeep<MaterializeAuctionsUsecaseDb>();
    entries = mockDeep<RaceEntryService>();
    floors = mockDeep<ZoneFloorPriceService>();
    db.findCandidates.mockResolvedValueOnce([candidate]);
    db.createScheduled.mockResolvedValue(9);
    entries.assertVerified.mockResolvedValue(undefined);
    floors.listForAthlete.mockResolvedValue(
      ZONE_ORDER.map((zone) => ({ zone, floorPriceCents: cents(2500), isDefault: false })),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        MaterializeAuctionsUsecase,
        { provide: MaterializeAuctionsUsecaseDb, useValue: db },
        { provide: RaceEntryService, useValue: entries },
        { provide: ZoneFloorPriceService, useValue: floors },
      ],
    }).compile();
    usecase = moduleRef.get(MaterializeAuctionsUsecase);
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  describe('when the window has not ended', () => {
    it('creates one scheduled row per zone with the window and the athlete floor', async () => {
      const created = await usecase.execute(now);

      expect(created).toBe(9);
      expect(db.createScheduled).toHaveBeenCalledWith(
        ZONE_ORDER.map((zone) => ({
          raceEntryId: candidate.raceEntryId,
          zone,
          floorPriceCents: cents(2500),
          openAt: new Date('2026-11-02T06:00:00Z'),
          closeAt: new Date('2026-11-09T06:00:00Z'),
        })),
      );
    });
  });

  describe('when verified after the window opened but before it closes', () => {
    it('still creates the rows with the original close', async () => {
      await usecase.execute(new Date('2026-11-05T12:00:00Z'));

      expect(db.createScheduled).toHaveBeenCalledOnce();
    });
  });

  describe('when the close time has already passed', () => {
    it('creates nothing', async () => {
      const created = await usecase.execute(new Date('2026-11-09T06:00:00Z'));

      expect(created).toBe(0);
      expect(db.createScheduled).not.toHaveBeenCalled();
    });
  });

  describe('when the verification gate rejects the entry', () => {
    beforeEach(() => {
      entries.assertVerified.mockRejectedValue(new ConflictError('race_entry_not_verified'));
    });

    it('skips the entry and creates nothing', async () => {
      const created = await usecase.execute(now);

      expect(created).toBe(0);
      expect(db.createScheduled).not.toHaveBeenCalled();
    });

    it('logs the skip', async () => {
      await usecase.execute(now);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('entry-1'));
    });
  });

  describe('when a race has an invalid timezone', () => {
    beforeEach(() => {
      db.findCandidates.mockReset();
      db.findCandidates.mockResolvedValueOnce([
        { ...candidate, timezone: null },
        { ...candidate, raceEntryId: 'entry-2' as RaceEntryId },
      ]);
    });

    it('skips that entry and processes the next', async () => {
      const created = await usecase.execute(now);

      expect(created).toBe(9);
      expect(db.createScheduled).toHaveBeenCalledOnce();
    });

    it('logs the skip with the entry id', async () => {
      await usecase.execute(now);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('entry-1'));
    });
  });

  describe('when creating rows for one entry throws', () => {
    beforeEach(() => {
      db.findCandidates.mockReset();
      db.findCandidates.mockResolvedValueOnce([candidate, { ...candidate, raceEntryId: 'entry-2' as RaceEntryId }]);
      db.createScheduled.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(9);
    });

    it('still processes the next entry', async () => {
      const created = await usecase.execute(now);

      expect(created).toBe(9);
    });

    it('logs the failure', async () => {
      await usecase.execute(now);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });
});
