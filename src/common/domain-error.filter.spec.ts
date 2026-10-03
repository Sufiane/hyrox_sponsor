import { Logger, type ArgumentsHost } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { DomainError, InvalidValueError } from './domain-error';
import { DomainErrorFilter } from './domain-error.filter';

class UnmappedError extends DomainError {}

describe('DomainErrorFilter', () => {
  let warn: MockInstance;
  let json: ReturnType<typeof vi.fn>;
  let status: ReturnType<typeof vi.fn>;
  let host: ArgumentsHost;
  let filter: DomainErrorFilter;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    host = {
      switchToHttp: (): unknown => ({ getResponse: (): unknown => ({ status }) }),
    } as unknown as ArgumentsHost;
    filter = new DomainErrorFilter();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when an InvalidValueError is caught', () => {
    beforeEach(() => {
      filter.catch(new InvalidValueError('email_invalid'), host);
    });

    it('responds 400', () => {
      expect(status).toHaveBeenCalledWith(400);
    });

    it('responds with the Nest HttpException body shape', () => {
      expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'email_invalid', error: 'Bad Request' });
    });

    it('logs a warning containing only the code', () => {
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('email_invalid');
    });
  });

  describe('when an unmapped DomainError is caught', () => {
    beforeEach(() => {
      filter.catch(new UnmappedError('something_else'), host);
    });

    it('responds 500', () => {
      expect(status).toHaveBeenCalledWith(500);
    });

    it('responds with the internal server error body', () => {
      expect(json).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'something_else',
        error: 'Internal Server Error',
      });
    });
  });
});
