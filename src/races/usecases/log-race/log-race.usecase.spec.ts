import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { LogRaceInput } from './log-race-input';
import { LogRaceUsecase } from './log-race.usecase';
import { LogRaceUsecaseDb } from './log-race.usecase.db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/domain-error';
import type { IanaTimezone } from '../../../common/iana-timezone';
import type { AthleteId } from '../../../common/ids';

describe('LogRaceUsecase', () => {
  const athleteId = 'athlete-1' as AthleteId;
  const input: LogRaceInput = {
    name: 'Hyrox Chicago',
    date: new Date('2026-11-15T03:30:00Z'),
    timezone: 'America/Chicago' as IanaTimezone,
    location: 'Chicago, IL',
    division: 'SINGLE_OPEN_MEN',
  };
  let db: DeepMockProxy<LogRaceUsecaseDb>;
  let usecase: LogRaceUsecase;
  let warn: MockInstance;

  beforeEach(async () => {
    db = mockDeep<LogRaceUsecaseDb>();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [LogRaceUsecase, { provide: LogRaceUsecaseDb, useValue: db }],
    }).compile();
    usecase = moduleRef.get(LogRaceUsecase);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the athlete does not exist', () => {
    beforeEach(() => {
      db.findAthleteStanding.mockResolvedValue(null);
    });

    it('throws NotFoundError with athlete_not_found', async () => {
      const result = usecase.execute(athleteId, input);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('athlete_not_found');
    });

    it('logs the athlete id', async () => {
      await usecase.execute(athleteId, input).catch(() => undefined);

      expect(warn).toHaveBeenCalledWith('Athlete athlete-1 not found');
    });
  });

  describe('when the athlete is banned', () => {
    beforeEach(() => {
      db.findAthleteStanding.mockResolvedValue({ isBanned: true });
    });

    it('throws ForbiddenError with athlete_banned', async () => {
      const result = usecase.execute(athleteId, input);

      await expect(result).rejects.toThrow(ForbiddenError);
      await expect(result).rejects.toThrow('athlete_banned');
    });

    it('does not write', async () => {
      await usecase.execute(athleteId, input).catch(() => undefined);

      expect(db.createEntry).not.toHaveBeenCalled();
    });
  });

  describe('when the athlete is in good standing', () => {
    const entry = { id: 'entry-1' };

    beforeEach(() => {
      db.findAthleteStanding.mockResolvedValue({ isBanned: false });
      db.createEntry.mockResolvedValue(entry as never);
    });

    it('returns the created entry', async () => {
      const result = await usecase.execute(athleteId, input);

      expect(result).toBe(entry);
    });

    it('writes the parsed race with its normalized name key and the local calendar date', async () => {
      await usecase.execute(athleteId, input);

      expect(db.createEntry).toHaveBeenCalledWith({
        athleteId,
        race: {
          name: 'Hyrox Chicago',
          nameKey: 'hyrox_chicago',
          date: new Date('2026-11-15T03:30:00Z'),
          timezone: 'America/Chicago',
          location: 'Chicago, IL',
        },
        division: 'SINGLE_OPEN_MEN',
        raceLocalDate: new Date('2026-11-14T00:00:00Z'),
      });
    });
  });

  describe('when the athlete already has an entry on that local date', () => {
    beforeEach(() => {
      db.findAthleteStanding.mockResolvedValue({ isBanned: false });
      db.createEntry.mockResolvedValue(null);
    });

    it('throws ConflictError with race_entry_date_conflict', async () => {
      const result = usecase.execute(athleteId, input);

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow('race_entry_date_conflict');
    });

    it('logs the athlete id and local date', async () => {
      await usecase.execute(athleteId, input).catch(() => undefined);

      expect(warn).toHaveBeenCalledWith('Athlete athlete-1 already has a race entry on 2026-11-14');
    });
  });
});
