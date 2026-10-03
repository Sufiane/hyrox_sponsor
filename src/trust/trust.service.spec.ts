import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { TrustService } from './trust.service';
import { StrikeDb } from './strike.db';
import { TrustScoreEventDb } from './trust-score-event.db';
import type { AthleteId } from '../common/ids';

describe('TrustService', () => {
  let strikeDb: DeepMockProxy<StrikeDb>;
  let trustScoreEventDb: DeepMockProxy<TrustScoreEventDb>;
  let service: TrustService;

  beforeEach(async () => {
    strikeDb = mockDeep<StrikeDb>();
    trustScoreEventDb = mockDeep<TrustScoreEventDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TrustService,
        { provide: StrikeDb, useValue: strikeDb },
        { provide: TrustScoreEventDb, useValue: trustScoreEventDb },
      ],
    }).compile();
    service = moduleRef.get(TrustService);
  });

  describe('getActiveStrikeCount', () => {
    describe('when the db reports active strikes', () => {
      beforeEach(() => {
        strikeDb.countActiveByAthlete.mockResolvedValue(2);
      });

      // The excluded-from-count filtering lives in the SQL query, which unit tests here do not cover.
      it('returns the count the db reports', async () => {
        const result = await service.getActiveStrikeCount('athlete-1' as AthleteId);

        expect(strikeDb.countActiveByAthlete).toHaveBeenCalledWith('athlete-1');
        expect(result).toBe(2);
      });
    });

    describe('when the db reports no active strikes', () => {
      beforeEach(() => {
        strikeDb.countActiveByAthlete.mockResolvedValue(0);
      });

      it('returns zero', async () => {
        const result = await service.getActiveStrikeCount('athlete-1' as AthleteId);

        expect(result).toBe(0);
      });
    });
  });

  describe('getScoreHistory', () => {
    const events = [{ id: 'event-1', oldValue: 50, newValue: 45 }];

    beforeEach(() => {
      trustScoreEventDb.findByAthlete.mockResolvedValue(events as never);
    });

    it('delegates to TrustScoreEventDb', async () => {
      const result = await service.getScoreHistory('athlete-1' as AthleteId);

      expect(result).toEqual(events);
    });
  });
});
