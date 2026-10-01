import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { RaceService } from './race.service.js';
import { RaceDb } from './race.db.js';
import type { RaceId } from '../common/ids.js';

describe('RaceService', () => {
  let db: DeepMockProxy<RaceDb>;
  let service: RaceService;

  beforeEach(async () => {
    db = mockDeep<RaceDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [RaceService, { provide: RaceDb, useValue: db }],
    }).compile();
    service = moduleRef.get(RaceService);
  });

  describe('getById', () => {
    describe('when the race exists', () => {
      const race = { id: 'race-1', name: 'Chicago Hyrox' };

      beforeEach(() => {
        db.findById.mockResolvedValue(race as never);
      });

      it('returns the race', async () => {
        const result = await service.getById('race-1' as RaceId);

        expect(result).toEqual(race);
      });
    });

    describe('when the race does not exist', () => {
      let warn: MockInstance;

      beforeEach(() => {
        db.findById.mockResolvedValue(null);
        warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      afterEach(() => {
        warn.mockRestore();
      });

      it('throws NotFoundException', async () => {
        await expect(service.getById('missing' as RaceId)).rejects.toThrow(NotFoundException);
      });

      it('throws the race_not_found code', async () => {
        await expect(service.getById('missing' as RaceId)).rejects.toThrow('race_not_found');
      });

      it('logs the missing id', async () => {
        await service.getById('missing' as RaceId).catch(() => undefined);

        expect(warn).toHaveBeenCalledWith('Race missing not found');
      });
    });
  });
});
