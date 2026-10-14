import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { InvalidValueError } from '../../common/domain-error';
import { createValidationPipe } from '../../common/validation-pipe';
import { ApproveVerificationDto } from './approve-verification.dto';

const metadata: ArgumentMetadata = { type: 'body', metatype: ApproveVerificationDto };
const validKey = 'race-entries/entry1/123e4567-e89b-12d3-a456-426614174000.pdf';

describe('ApproveVerificationDto', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the document key is valid', () => {
    it('exposes the branded key', async () => {
      const result = (await createValidationPipe().transform({ reviewedDocumentKey: validKey }, metadata)) as ApproveVerificationDto;

      expect(result.reviewedDocumentKey).toBe(validKey);
    });
  });

  describe('when the document key is malformed', () => {
    it('rejects with document_key_invalid', async () => {
      const result = createValidationPipe().transform({ reviewedDocumentKey: 'nope' }, metadata);

      await expect(result).rejects.toThrow(InvalidValueError);
      await expect(result).rejects.toThrow('document_key_invalid');
    });
  });

  describe('when the document key is missing', () => {
    it('rejects with validation_failed', async () => {
      const result = createValidationPipe().transform({}, metadata);

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow('validation_failed');
    });
  });
});
