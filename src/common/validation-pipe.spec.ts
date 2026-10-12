import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { SignupDto } from '../auth/dto/signup.dto';
import { createValidationPipe } from './validation-pipe';

const metadata: ArgumentMetadata = { type: 'body', metatype: SignupDto };
const valid = {
  name: ' Jamie Lee ',
  email: 'jamie@example.com',
  password: 'long-enough-password',
  adultAttested: true,
  tosVersion: '2026-10-10-draft',
};

describe('createValidationPipe', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the body has an unknown field', () => {
    it('rejects with validation_failed', async () => {
      const pipe = createValidationPipe();

      await expect(pipe.transform({ ...valid, role: 'admin' }, metadata)).rejects.toThrow(BadRequestException);
      await expect(pipe.transform({ ...valid, role: 'admin' }, metadata)).rejects.toThrow('validation_failed');
    });
  });

  describe('when a field fails a constraint', () => {
    it('rejects with validation_failed', async () => {
      await expect(createValidationPipe().transform({ ...valid, password: 'short' }, metadata)).rejects.toThrow(
        'validation_failed',
      );
    });

    it('logs the field name', async () => {
      await createValidationPipe()
        .transform({ ...valid, password: 'short' }, metadata)
        .catch(() => undefined);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('password'));
    });

    it('does not log the rejected value', async () => {
      await createValidationPipe()
        .transform({ ...valid, password: 'short' }, metadata)
        .catch(() => undefined);

      expect(JSON.stringify(warn.mock.calls)).not.toContain('"short"');
    });
  });

  describe('when tosVersion has the wrong type', () => {
    it('rejects with validation_failed', async () => {
      await expect(createValidationPipe().transform({ ...valid, tosVersion: 5 }, metadata)).rejects.toThrow(
        'validation_failed',
      );
    });
  });

  describe('when tosVersion is out of bounds', () => {
    it.each(['', 'a'.repeat(65)])('rejects length %#', async (tosVersion) => {
      await expect(createValidationPipe().transform({ ...valid, tosVersion }, metadata)).rejects.toThrow(
        'validation_failed',
      );
    });
  });

  describe('when tosVersion is omitted', () => {
    it('passes the pipe', async () => {
      const withoutTosVersion = { ...valid, tosVersion: undefined };

      await expect(createValidationPipe().transform(withoutTosVersion, metadata)).resolves.toBeInstanceOf(SignupDto);
    });
  });

  describe('when the body is valid', () => {
    it('returns the transformed DTO', async () => {
      const result = await createValidationPipe().transform(valid, metadata);

      expect(result).toBeInstanceOf(SignupDto);
      expect(result).toMatchObject({ name: 'Jamie Lee', email: 'jamie@example.com' });
    });
  });
});
