import { NotFoundException } from '@nestjs/common';
import { AthleteService } from './athlete.service.js';
import { AthleteDb } from './athlete.db.js';
import type { AthleteId } from '../common/ids.js';

describe('AthleteService', () => {
  describe('getById', () => {
    describe('when the athlete exists', () => {
      it('returns the athlete', async () => {
        const athlete = { id: 'athlete-1', name: 'Jamie Lee' };
        const db = { findById: vi.fn().mockResolvedValue(athlete) } as unknown as AthleteDb;
        const service = new AthleteService(db);

        const result = await service.getById('athlete-1' as AthleteId);

        expect(result).toEqual(athlete);
      });
    });

    describe('when the athlete does not exist', () => {
      it('throws NotFoundException', async () => {
        const db = { findById: vi.fn().mockResolvedValue(null) } as unknown as AthleteDb;
        const service = new AthleteService(db);

        await expect(service.getById('missing' as AthleteId)).rejects.toThrow(NotFoundException);
      });
    });
  });
});
