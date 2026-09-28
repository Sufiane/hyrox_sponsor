import { TrustService } from './trust.service.js';
import { StrikeDb } from './strike.db.js';
import { TrustScoreEventDb } from './trust-score-event.db.js';

describe('TrustService', () => {
  describe('getActiveStrikeCount', () => {
    describe('when the athlete has active strikes', () => {
      it('returns the count of strikes not excluded from counting', async () => {
        const strikeDb = {
          findActiveByAthlete: vi
            .fn()
            .mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
        } as unknown as StrikeDb;
        const trustScoreEventDb = {} as TrustScoreEventDb;
        const service = new TrustService(strikeDb, trustScoreEventDb);

        const result = await service.getActiveStrikeCount('athlete-1');

        expect(result).toBe(2);
      });
    });

    describe('when the athlete has no active strikes', () => {
      it('returns zero', async () => {
        const strikeDb = {
          findActiveByAthlete: vi.fn().mockResolvedValue([]),
        } as unknown as StrikeDb;
        const trustScoreEventDb = {} as TrustScoreEventDb;
        const service = new TrustService(strikeDb, trustScoreEventDb);

        const result = await service.getActiveStrikeCount('athlete-1');

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

      const result = await service.getScoreHistory('athlete-1');

      expect(result).toEqual(events);
    });
  });
});
