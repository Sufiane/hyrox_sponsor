import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe';
import { SubmitVerificationDto } from './submit-verification.dto';

const metadata: ArgumentMetadata = { type: 'body', metatype: SubmitVerificationDto };

describe('SubmitVerificationDto', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the bib number is valid', () => {
    it('trims it', async () => {
      const result = (await createValidationPipe().transform({ bibNumber: ' A123 ' }, metadata)) as SubmitVerificationDto;

      expect(result.bibNumber).toBe('A123');
    });
  });

  describe('when the bib number is invalid', () => {
    it.each([['blank', '   '], ['21 characters', 'a'.repeat(21)], ['a number', 123], ['missing', undefined]])(
      'rejects with validation_failed for %s',
      async (_name, bibNumber) => {
        const result = createValidationPipe().transform({ bibNumber }, metadata);

        await expect(result).rejects.toThrow(BadRequestException);
        await expect(result).rejects.toThrow('validation_failed');
      },
    );
  });
});
