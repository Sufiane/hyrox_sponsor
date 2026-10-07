import { UnauthorizedException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { InvalidValueError } from '../common/domain-error';
import type { AthleteId, RaceEntryId } from '../common/ids';
import type { RaceEntryParamsDto } from './dto/race-entry-params.dto';
import type { SubmitVerificationDto } from './dto/submit-verification.dto';
import { RaceEntryService } from './race-entry.service';
import { RaceEntryVerificationController } from './race-entry-verification.controller';

describe('RaceEntryVerificationController', () => {
  const athleteId = 'athlete-1' as AthleteId;
  const raceEntryId = 'entry-1' as RaceEntryId;
  const params = { raceEntryId } as RaceEntryParamsDto;
  const body = { bibNumber: 'A123' } as SubmitVerificationDto;
  const file = { buffer: Buffer.from('%PDF-1.7') } as Express.Multer.File;
  let service: DeepMockProxy<RaceEntryService>;
  let controller: RaceEntryVerificationController;

  beforeEach(() => {
    service = mockDeep<RaceEntryService>();
    controller = new RaceEntryVerificationController(service);
  });

  describe('submitDocument', () => {
    describe('when no file is attached', () => {
      it('throws document_missing', async () => {
        await expect(controller.submitDocument(athleteId, params, body, undefined)).rejects.toThrow(InvalidValueError);
        await expect(controller.submitDocument(athleteId, params, body, undefined)).rejects.toThrow('document_missing');
      });
    });

    describe('when the athlete id is undefined', () => {
      it('throws invalid_token', async () => {
        await expect(controller.submitDocument(undefined, params, body, file)).rejects.toThrow(UnauthorizedException);
        await expect(controller.submitDocument(undefined, params, body, file)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the request is valid', () => {
      const submittedAt = new Date('2026-10-03T12:00:00Z');

      beforeEach(() => {
        service.submitVerificationDocument.mockResolvedValue({ submittedAt, verificationStatus: 'PENDING' });
      });

      it('delegates and returns the submission', async () => {
        const result = await controller.submitDocument(athleteId, params, body, file);

        expect(service.submitVerificationDocument).toHaveBeenCalledWith({
          athleteId,
          raceEntryId,
          bibNumber: 'A123',
          file: file.buffer,
        });
        expect(result).toEqual({ raceEntryId, verificationStatus: 'PENDING', submittedAt });
      });
    });
  });

  describe('getStatus', () => {
    describe('when the athlete id is undefined', () => {
      it('throws invalid_token', async () => {
        await expect(controller.getStatus(undefined, params)).rejects.toThrow('invalid_token');
      });
    });

    describe('when the request is valid', () => {
      const view = { raceEntryId } as never;

      beforeEach(() => {
        service.getVerificationStatus.mockResolvedValue(view);
      });

      it('delegates with the athlete id and race entry id', async () => {
        expect(await controller.getStatus(athleteId, params)).toBe(view);
        expect(service.getVerificationStatus).toHaveBeenCalledWith(athleteId, raceEntryId);
      });
    });
  });
});
