import { RaceEntryService } from './race-entry.service.js';
import { RaceEntryDb } from './race-entry.db.js';

describe('RaceEntryService', () => {
  describe('isVerified', () => {
    describe('when no race entry exists', () => {
      it('returns false', async () => {
        const db = {
          findByAthleteAndRace: vi.fn().mockResolvedValue(null),
        } as unknown as RaceEntryDb;
        const service = new RaceEntryService(db);

        const result = await service.isVerified('athlete-1', 'race-1');

        expect(result).toBe(false);
      });
    });

    describe('when the race entry is VERIFIED', () => {
      it('returns true', async () => {
        const db = {
          findByAthleteAndRace: vi
            .fn()
            .mockResolvedValue({ verificationStatus: 'VERIFIED' }),
        } as unknown as RaceEntryDb;
        const service = new RaceEntryService(db);

        const result = await service.isVerified('athlete-1', 'race-1');

        expect(result).toBe(true);
      });
    });

    describe('when the race entry is PENDING', () => {
      it('returns false', async () => {
        const db = {
          findByAthleteAndRace: vi
            .fn()
            .mockResolvedValue({ verificationStatus: 'PENDING' }),
        } as unknown as RaceEntryDb;
        const service = new RaceEntryService(db);

        const result = await service.isVerified('athlete-1', 'race-1');

        expect(result).toBe(false);
      });
    });
  });
});
