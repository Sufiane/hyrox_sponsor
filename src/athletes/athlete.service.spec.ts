import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AthleteService } from './athlete.service.js';
import { AthleteDb } from './athlete.db.js';
import type { AthleteId } from '../common/ids.js';

describe('AthleteService', () => {
  let db: DeepMockProxy<AthleteDb>;
  let service: AthleteService;

  beforeEach(async () => {
    db = mockDeep<AthleteDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [AthleteService, { provide: AthleteDb, useValue: db }],
    }).compile();
    service = moduleRef.get(AthleteService);
  });

  describe('getById', () => {
    describe('when the athlete exists', () => {
      const athlete = { id: 'athlete-1', name: 'Jamie Lee' };

      beforeEach(() => {
        db.findById.mockResolvedValue(athlete as never);
      });

      it('returns the athlete', async () => {
        const result = await service.getById('athlete-1' as AthleteId);

        expect(result).toEqual(athlete);
      });
    });

    describe('when the athlete does not exist', () => {
      let warn: MockInstance;

      beforeEach(() => {
        db.findById.mockResolvedValue(null);
        warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      afterEach(() => {
        warn.mockRestore();
      });

      it('throws NotFoundException', async () => {
        await expect(service.getById('missing' as AthleteId)).rejects.toThrow(NotFoundException);
      });

      it('throws the athlete_not_found code', async () => {
        await expect(service.getById('missing' as AthleteId)).rejects.toThrow('athlete_not_found');
      });

      it('logs the missing id', async () => {
        await service.getById('missing' as AthleteId).catch(() => undefined);

        expect(warn).toHaveBeenCalledWith('Athlete missing not found');
      });
    });
  });
});
