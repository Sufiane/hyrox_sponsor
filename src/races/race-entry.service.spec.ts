import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { RaceEntryService } from './race-entry.service';
import { RaceEntryDb } from './race-entry.db';
import { LogRaceUsecase } from './usecases/log-race/log-race.usecase';
import type { AthleteId, RaceId } from '../common/ids';
import type { LogRaceInput } from './usecases/log-race/log-race-input';

describe('RaceEntryService', () => {
  let db: DeepMockProxy<RaceEntryDb>;
  let logRace: DeepMockProxy<LogRaceUsecase>;
  let service: RaceEntryService;

  beforeEach(async () => {
    db = mockDeep<RaceEntryDb>();
    logRace = mockDeep<LogRaceUsecase>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RaceEntryService,
        { provide: RaceEntryDb, useValue: db },
        { provide: LogRaceUsecase, useValue: logRace },
      ],
    }).compile();
    service = moduleRef.get(RaceEntryService);
  });

  describe('isVerified', () => {
    describe('when no race entry exists', () => {
      beforeEach(() => {
        db.findByAthleteAndRace.mockResolvedValue(null);
      });

      it('returns false', async () => {
        const result = await service.isVerified('athlete-1' as AthleteId, 'race-1' as RaceId);

        expect(result).toBe(false);
      });
    });

    describe('when the race entry is VERIFIED', () => {
      beforeEach(() => {
        db.findByAthleteAndRace.mockResolvedValue({ verificationStatus: 'VERIFIED' } as never);
      });

      it('returns true', async () => {
        const result = await service.isVerified('athlete-1' as AthleteId, 'race-1' as RaceId);

        expect(result).toBe(true);
      });
    });

    describe('when the race entry is PENDING', () => {
      beforeEach(() => {
        db.findByAthleteAndRace.mockResolvedValue({ verificationStatus: 'PENDING' } as never);
      });

      it('returns false', async () => {
        const result = await service.isVerified('athlete-1' as AthleteId, 'race-1' as RaceId);

        expect(result).toBe(false);
      });
    });
  });

  describe('logRace', () => {
    describe('when called', () => {
      const entry = { id: 'entry-1' };
      const body = { name: 'Hyrox Chicago' } as LogRaceInput;

      beforeEach(() => {
        logRace.execute.mockResolvedValue(entry as never);
      });

      it('delegates to the usecase and returns its result', async () => {
        const result = await service.logRace('athlete-1' as AthleteId, body);

        expect(logRace.execute).toHaveBeenCalledWith('athlete-1', body);
        expect(result).toBe(entry);
      });
    });
  });
});
