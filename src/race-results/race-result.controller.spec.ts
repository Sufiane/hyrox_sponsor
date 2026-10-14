import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UnauthorizedException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AthleteId, RaceEntryId } from '../common/ids';
import type { Seconds } from '../common/seconds';
import type { RaceEntryParamsDto } from '../races/dto/race-entry-params.dto';
import type { SubmitRaceResultDto } from './dto/submit-race-result.dto';
import { RaceResultController } from './race-result.controller';
import { RaceResultService } from './race-result.service';

describe('RaceResultController', () => {
  const athleteId = 'athlete-1' as AthleteId;
  const raceEntryId = 'entry-1' as RaceEntryId;
  const params = { raceEntryId } as RaceEntryParamsDto;
  const body = { finishTimeSeconds: 4_000 as Seconds, proofUrl: 'https://x.test/a' } as SubmitRaceResultDto;
  const file = { buffer: Buffer.from([0xff, 0xd8, 0xff]) } as Express.Multer.File;
  let service: DeepMockProxy<RaceResultService>;
  let controller: RaceResultController;

  beforeEach(() => {
    service = mockDeep<RaceResultService>();
    controller = new RaceResultController(service);
  });

  it('is guarded by JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RaceResultController)).toEqual([JwtAuthGuard]);
  });

  describe('submitResult', () => {
    describe('when the athlete id is undefined', () => {
      it('throws invalid_token', async () => {
        await expect(controller.submitResult(undefined, params, body, file)).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('when the request has a photo', () => {
      const submittedAt = new Date('2026-10-03T12:00:00Z');

      beforeEach(() => {
        service.submit.mockResolvedValue({ status: 'PENDING', submittedAt, publicVisible: false });
      });

      it('delegates with the token athlete id and returns the submission', async () => {
        const result = await controller.submitResult(athleteId, params, body, file);

        expect(service.submit).toHaveBeenCalledWith({
          athleteId,
          raceEntryId,
          finishTimeSeconds: 4_000,
          proofUrl: 'https://x.test/a',
          photo: file.buffer,
        });
        expect(result).toEqual({ raceEntryId, status: 'PENDING', submittedAt, publicVisible: false });
      });
    });

    describe('when the request has no photo and no link', () => {
      beforeEach(() => {
        service.submit.mockResolvedValue({ status: 'PENDING', submittedAt: new Date(), publicVisible: true });
      });

      it('passes nulls so the usecase decides', async () => {
        await controller.submitResult(athleteId, params, { finishTimeSeconds: 4_000 as Seconds }, undefined);

        expect(service.submit).toHaveBeenCalledWith(expect.objectContaining({ proofUrl: null, photo: null }));
      });
    });
  });

  describe('getOwnResult', () => {
    it('delegates with the token athlete id', async () => {
      await controller.getOwnResult(athleteId, params);

      expect(service.getOwnResult).toHaveBeenCalledWith(athleteId, raceEntryId);
    });

    it('throws invalid_token without an athlete id', () => {
      expect(() => controller.getOwnResult(undefined, params)).toThrow(UnauthorizedException);
    });
  });

  describe('listOwnEntries', () => {
    it('wraps the entries in items', async () => {
      service.listOwnEntries.mockResolvedValue([]);

      await expect(controller.listOwnEntries(athleteId)).resolves.toEqual({ items: [] });
      expect(service.listOwnEntries).toHaveBeenCalledWith(athleteId);
    });
  });
});
