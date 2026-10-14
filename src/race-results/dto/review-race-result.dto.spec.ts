import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe';
import { ApproveRaceResultDto, RejectRaceResultDto } from './review-race-result.dto';

const approveMetadata: ArgumentMetadata = { type: 'body', metatype: ApproveRaceResultDto };
const rejectMetadata: ArgumentMetadata = { type: 'body', metatype: RejectRaceResultDto };

describe('review race result dtos', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('ApproveRaceResultDto', () => {
    describe('when submittedAt is an ISO date', () => {
      it('converts it to a Date', async () => {
        const result = (await createValidationPipe().transform(
          { submittedAt: '2026-10-02T09:00:00.123Z' },
          approveMetadata,
        )) as ApproveRaceResultDto;

        expect(result.submittedAt).toEqual(new Date('2026-10-02T09:00:00.123Z'));
      });
    });

    describe('when submittedAt is invalid', () => {
      it.each([['garbage', 'nope'], ['missing', undefined], ['a number', 5]])(
        'rejects with validation_failed for %s',
        async (_name, submittedAt) => {
          const result = createValidationPipe().transform({ submittedAt }, approveMetadata);

          await expect(result).rejects.toThrow(BadRequestException);
          await expect(result).rejects.toThrow('validation_failed');
        },
      );
    });
  });

  describe('RejectRaceResultDto', () => {
    describe('when the reason is valid', () => {
      it('trims it', async () => {
        const result = (await createValidationPipe().transform(
          { submittedAt: '2026-10-02T09:00:00.123Z', reason: '  blurry  ' },
          rejectMetadata,
        )) as RejectRaceResultDto;

        expect(result.reason).toBe('blurry');
      });
    });

    describe('when the reason is invalid', () => {
      it.each([['blank', '   '], ['501 characters', 'a'.repeat(501)], ['missing', undefined]])(
        'rejects with validation_failed for %s',
        async (_name, reason) => {
          const result = createValidationPipe().transform(
            { submittedAt: '2026-10-02T09:00:00.123Z', reason },
            rejectMetadata,
          );

          await expect(result).rejects.toThrow('validation_failed');
        },
      );
    });
  });
});
