import { NotFoundException } from '@nestjs/common';
import { RaceService } from './race.service.js';
import { RaceDb } from './race.db.js';

describe('RaceService', () => {
  describe('getById', () => {
    describe('when the race exists', () => {
      it('returns the race', async () => {
        const race = { id: 'race-1', name: 'Chicago Hyrox' };
        const db = { findById: vi.fn().mockResolvedValue(race) } as unknown as RaceDb;
        const service = new RaceService(db);

        const result = await service.getById('race-1');

        expect(result).toEqual(race);
      });
    });

    describe('when the race does not exist', () => {
      it('throws NotFoundException', async () => {
        const db = { findById: vi.fn().mockResolvedValue(null) } as unknown as RaceDb;
        const service = new RaceService(db);

        await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
      });
    });
  });
});
