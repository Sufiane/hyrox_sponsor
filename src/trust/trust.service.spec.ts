import { TrustService } from './trust.service.js';
import { StrikeDb } from './strike.db.js';
import { TrustScoreEventDb } from './trust-score-event.db.js';
import type { AthleteId } from '../common/ids.js';

describe('TrustService', () => {
  describe('getActiveStrikeCount', () => {
    describe('when the db reports active strikes', () => {
      // The excluded-from-count filtering lives in the SQL query, which unit tests here do not cover.
      it('returns the count the db reports', async () => {
        const strikeDb = {
          countActiveByAthlete: vi.fn().mockResolvedValue(2),
        } as unknown as StrikeDb;
        const trustScoreEventDb = {} as TrustScoreEventDb;
        const service = new TrustService(strikeDb, trustScoreEventDb);

        const result = await service.getActiveStrikeCount('athlete-1' as AthleteId);

        expect(strikeDb.countActiveByAthlete).toHaveBeenCalledWith('athlete-1');
        expect(result).toBe(2);
      });
    });

    describe('when the db reports no active strikes', () => {
      it('returns zero', async () => {
        const strikeDb = {
          countActiveByAthlete: vi.fn().mockResolvedValue(0),
        } as unknown as StrikeDb;
        const trustScoreEventDb = {} as TrustScoreEventDb;
        const service = new TrustService(strikeDb, trustScoreEventDb);

        const result = await service.getActiveStrikeCount('athlete-1' as AthleteId);

        expect(result).toBe(0);
      });
    });
  });

  describe('getScoreHistory', () => {
    it('delegates to TrustScoreEventDb', async () => {
      const strikeDb = {} as StrikeDb;
      const events = [{ id: 'event-1', oldValue: 50, newValue: 45 }];
      const trustScoreEventDb = {
        findByAthlete: vi.fn().mockResolvedValue(events),
      } as unknown as TrustScoreEventDb;
      const service = new TrustService(strikeDb, trustScoreEventDb);

      const result = await service.getScoreHistory('athlete-1' as AthleteId);

      expect(result).toEqual(events);
    });
  });
});
