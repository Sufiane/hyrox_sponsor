import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { InvalidValueError } from '../../common/domain-error';
import { createValidationPipe } from '../../common/validation-pipe';
import { SubmitRaceResultDto } from './submit-race-result.dto';

const metadata: ArgumentMetadata = { type: 'body', metatype: SubmitRaceResultDto };

describe('SubmitRaceResultDto', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the time is a numeric string within bounds', () => {
    it('converts it to branded seconds', async () => {
      const result = (await createValidationPipe().transform(
        { finishTimeSeconds: ' 4000 ', proofUrl: 'https://x.test/a' },
        metadata,
      )) as SubmitRaceResultDto;

      expect(result.finishTimeSeconds).toBe(4_000);
      expect(result.proofUrl).toBe('https://x.test/a');
    });
  });

  describe('when the time is out of range', () => {
    it.each(['0', '100', '99999'])('throws finish_time_out_of_range for %s', async (value) => {
      const result = createValidationPipe().transform({ finishTimeSeconds: value }, metadata);

      await expect(result).rejects.toThrow(InvalidValueError);
      await expect(result).rejects.toThrow('finish_time_out_of_range');
    });
  });

  describe('when the time is a JSON number', () => {
    it('brands an in-range value', async () => {
      const result = (await createValidationPipe().transform(
        { finishTimeSeconds: 4_000 },
        metadata,
      )) as SubmitRaceResultDto;

      expect(result.finishTimeSeconds).toBe(4_000);
    });

    it.each([5, 99_999])('throws finish_time_out_of_range for %d', async (value) => {
      const result = createValidationPipe().transform({ finishTimeSeconds: value }, metadata);

      await expect(result).rejects.toThrow(InvalidValueError);
      await expect(result).rejects.toThrow('finish_time_out_of_range');
    });

    it('throws seconds_invalid for a fractional value', async () => {
      const result = createValidationPipe().transform({ finishTimeSeconds: 4_000.5 }, metadata);

      await expect(result).rejects.toThrow('seconds_invalid');
    });
  });

  describe('when the time is not a whole number', () => {
    it.each(['abc', '40.5', '-4000', '', '1e3', '1234567'])('throws seconds_invalid for %j', async (value) => {
      const result = createValidationPipe().transform({ finishTimeSeconds: value }, metadata);

      await expect(result).rejects.toThrow('seconds_invalid');
    });
  });

  describe('when the time is missing', () => {
    it('rejects with validation_failed', async () => {
      const result = createValidationPipe().transform({}, metadata);

      await expect(result).rejects.toThrow('validation_failed');
    });
  });

  describe('when the link is too long', () => {
    it('rejects with validation_failed', async () => {
      const result = createValidationPipe().transform(
        { finishTimeSeconds: '4000', proofUrl: 'a'.repeat(501) },
        metadata,
      );

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow('validation_failed');
    });
  });
});
