import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { RaceEntryService } from './race-entry.service.js';
import { RaceEntryDb } from './race-entry.db.js';
import type { AthleteId, RaceId } from '../common/ids.js';

describe('RaceEntryService', () => {
  let db: DeepMockProxy<RaceEntryDb>;
  let service: RaceEntryService;

  beforeEach(async () => {
    db = mockDeep<RaceEntryDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [RaceEntryService, { provide: RaceEntryDb, useValue: db }],
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
});
