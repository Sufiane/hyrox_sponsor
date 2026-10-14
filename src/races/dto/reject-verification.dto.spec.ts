import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { InvalidValueError } from '../../common/domain-error';
import { createValidationPipe } from '../../common/validation-pipe';
import { RejectVerificationDto } from './reject-verification.dto';

const metadata: ArgumentMetadata = { type: 'body', metatype: RejectVerificationDto };
const validKey = 'race-entries/entry1/123e4567-e89b-12d3-a456-426614174000.pdf';

describe('RejectVerificationDto', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the key and reason are valid', () => {
    it('exposes the key and the trimmed reason', async () => {
      const result = (await createValidationPipe().transform(
        { reviewedDocumentKey: validKey, reason: '  blurry  ' },
        metadata,
      )) as RejectVerificationDto;

      expect(result.reviewedDocumentKey).toBe(validKey);
      expect(result.reason).toBe('blurry');
    });
  });

  describe('when the reason is exactly 500 characters', () => {
    it('accepts it', async () => {
      const result = (await createValidationPipe().transform(
        { reviewedDocumentKey: validKey, reason: 'a'.repeat(500) },
        metadata,
      )) as RejectVerificationDto;

      expect(result.reason).toHaveLength(500);
    });
  });

  describe('when the reason is invalid', () => {
    it.each([['blank', '   '], ['501 characters', 'a'.repeat(501)], ['a number', 5], ['missing', undefined]])(
      'rejects with validation_failed for %s',
      async (_name, reason) => {
        const result = createValidationPipe().transform({ reviewedDocumentKey: validKey, reason }, metadata);

        await expect(result).rejects.toThrow(BadRequestException);
        await expect(result).rejects.toThrow('validation_failed');
      },
    );
  });

  describe('when the document key is malformed', () => {
    it('rejects with document_key_invalid', async () => {
      const result = createValidationPipe().transform({ reviewedDocumentKey: 'nope', reason: 'blurry' }, metadata);

      await expect(result).rejects.toThrow(InvalidValueError);
      await expect(result).rejects.toThrow('document_key_invalid');
    });
  });
});
