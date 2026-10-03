import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { InvalidValueError } from '../../common/domain-error';
import { createValidationPipe } from '../../common/validation-pipe';
import { LogRaceDto } from './log-race.dto';

const metadata: ArgumentMetadata = { type: 'body', metatype: LogRaceDto };
const valid = {
  name: 'Hyrox Chicago',
  date: '2026-11-14T09:00:00-06:00',
  timezone: 'America/Chicago',
  location: 'Chicago, IL',
  division: 'SINGLE_OPEN_MEN',
};

describe('LogRaceDto', () => {
  let warn: MockInstance;

  async function parse(body: unknown): Promise<LogRaceDto> {
    return (await createValidationPipe().transform(body, metadata)) as LogRaceDto;
  }

  async function failureFor(body: unknown): Promise<unknown> {
    try {
      await parse(body);
    } catch (error) {
      return error;
    }

    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  describe('when the body is valid', () => {
    it('returns the parsed values', async () => {
      const result = await parse(valid);

      expect({ ...result }).toEqual({
        name: 'Hyrox Chicago',
        date: new Date('2026-11-14T15:00:00Z'),
        timezone: 'America/Chicago',
        location: 'Chicago, IL',
        division: 'SINGLE_OPEN_MEN',
      });
    });
  });

  describe('when the name or location has surrounding or repeated whitespace', () => {
    it('trims and collapses it', async () => {
      const result = await parse({ ...valid, name: '  Hyrox   Chicago ', location: ' Chicago,\t IL ' });

      expect(result.name).toBe('Hyrox Chicago');
      expect(result.location).toBe('Chicago, IL');
    });
  });

  describe('when the name is blank, missing, not a string or over 120 characters', () => {
    it.each([['  '], [undefined], [5], ['a'.repeat(121)]])('rejects %s', async (name) => {
      await expect(parse({ ...valid, name })).rejects.toThrow('validation_failed');
    });
  });

  describe('when the location is blank, missing or over 120 characters', () => {
    it.each([[''], [undefined], ['a'.repeat(121)]])('rejects %s', async (location) => {
      await expect(parse({ ...valid, location })).rejects.toThrow('validation_failed');
    });
  });

  describe('when the date is not an ISO datetime with an offset', () => {
    it.each([['2026-11-14'], ['2026-11-14T09:00:00'], ['2026-13-40T09:00:00Z'], [123], [undefined]])(
      'rejects %s',
      async (date) => {
        await expect(parse({ ...valid, date })).rejects.toThrow('validation_failed');
      },
    );
  });

  describe('when the date has calendar-invalid components', () => {
    it.each([
      ['2026-02-30T10:00:00+01:00'],
      ['2026-04-31T10:00:00Z'],
      ['2027-02-29T10:00:00Z'],
      ['2026-11-14T24:00:00Z'],
      ['2026-11-14T10:60:00Z'],
      ['2026-11-14T10:00:60Z'],
      ['2026-00-10T10:00:00Z'],
    ])('rejects %s instead of rolling over', async (date) => {
      await expect(parse({ ...valid, date })).rejects.toThrow('validation_failed');
    });
  });

  describe('when the date is February 29 of a leap year', () => {
    it('accepts it', async () => {
      const result = await parse({ ...valid, date: '2028-02-29T10:00:00Z' });

      expect(result.date.toISOString()).toBe('2028-02-29T10:00:00.000Z');
    });
  });

  describe('when the date is before 2017-01-01', () => {
    it('rejects it', async () => {
      await expect(parse({ ...valid, date: '2016-12-31T09:00:00Z' })).rejects.toThrow('validation_failed');
    });
  });

  describe('when the date is more than two years ahead', () => {
    it('rejects it', async () => {
      await expect(parse({ ...valid, date: '2028-10-02T09:00:00Z' })).rejects.toThrow('validation_failed');
    });
  });

  describe('when the date is exactly two years ahead', () => {
    it('accepts it', async () => {
      await expect(parse({ ...valid, date: '2028-10-01T12:00:00Z' })).resolves.toBeDefined();
    });
  });

  describe('when the date is in the past but after 2017', () => {
    it('accepts it', async () => {
      await expect(parse({ ...valid, date: '2024-05-04T09:00:00Z' })).resolves.toBeDefined();
    });
  });

  describe('when the timezone is not an IANA id', () => {
    it('rejects with the iana_timezone_invalid domain error', async () => {
      const failure = await failureFor({ ...valid, timezone: 'Mars/Base' });

      expect(failure).toBeInstanceOf(InvalidValueError);
      expect((failure as InvalidValueError).code).toBe('iana_timezone_invalid');
    });
  });

  describe('when the timezone is not a string', () => {
    it('rejects with validation_failed', async () => {
      const failure = await failureFor({ ...valid, timezone: 7 });

      expect(failure).toBeInstanceOf(BadRequestException);
    });
  });

  describe('when the timezone is missing', () => {
    it('rejects with validation_failed', async () => {
      await expect(parse({ ...valid, timezone: undefined })).rejects.toThrow('validation_failed');
    });
  });

  describe('when the division is not in the enum', () => {
    it.each([['OPEN'], [undefined]])('rejects %s', async (division) => {
      await expect(parse({ ...valid, division })).rejects.toThrow('validation_failed');
    });
  });

  describe('when the body has an unknown field', () => {
    it('rejects it', async () => {
      await expect(parse({ ...valid, role: 'admin' })).rejects.toThrow('validation_failed');
    });
  });
});
