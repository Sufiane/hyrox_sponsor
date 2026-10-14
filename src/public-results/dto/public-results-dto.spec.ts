import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe';
import { ListRacesQueryDto } from './list-races-query.dto';
import { ListResultsQueryDto } from './list-results-query.dto';

const racesMetadata: ArgumentMetadata = { type: 'query', metatype: ListRacesQueryDto };
const resultsMetadata: ArgumentMetadata = { type: 'query', metatype: ListResultsQueryDto };

describe('public results query dtos', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('ListRacesQueryDto', () => {
    describe('when no query is given', () => {
      it('applies the default limit', async () => {
        const result = (await createValidationPipe().transform({}, racesMetadata)) as ListRacesQueryDto;

        expect(result.limit).toBe(20);
        expect(result.cursor).toBeUndefined();
      });
    });

    describe('when the query is valid', () => {
      it('converts the limit to a number', async () => {
        const result = (await createValidationPipe().transform(
          { limit: '50', cursor: 'abc' },
          racesMetadata,
        )) as ListRacesQueryDto;

        expect(result).toMatchObject({ limit: 50, cursor: 'abc' });
      });
    });

    describe('when the query is invalid', () => {
      it.each([
        ['limit 0', { limit: '0' }],
        ['limit 51', { limit: '51' }],
        ['limit not a number', { limit: 'x' }],
        ['cursor too long', { cursor: 'a'.repeat(201) }],
        ['unknown param', { sort: 'asc' }],
      ])('rejects with validation_failed for %s', async (_name, query) => {
        const result = createValidationPipe().transform(query, racesMetadata);

        await expect(result).rejects.toThrow(BadRequestException);
        await expect(result).rejects.toThrow('validation_failed');
      });
    });
  });

  describe('ListResultsQueryDto', () => {
    describe('when only the division is given', () => {
      it('applies the defaults', async () => {
        const result = (await createValidationPipe().transform(
          { division: 'SINGLE_OPEN_MEN' },
          resultsMetadata,
        )) as ListResultsQueryDto;

        expect(result).toMatchObject({ division: 'SINGLE_OPEN_MEN', limit: 50, offset: 0 });
      });
    });

    describe('when the query is invalid', () => {
      it.each([
        ['division missing', {}],
        ['division unknown', { division: 'NOPE' }],
        ['limit 101', { division: 'RELAY_MEN', limit: '101' }],
        ['offset negative', { division: 'RELAY_MEN', offset: '-1' }],
        ['offset 10001', { division: 'RELAY_MEN', offset: '10001' }],
      ])('rejects with validation_failed for %s', async (_name, query) => {
        const result = createValidationPipe().transform(query, resultsMetadata);

        await expect(result).rejects.toThrow('validation_failed');
      });
    });

    describe('when the limits are at their maximum', () => {
      it('accepts them', async () => {
        const result = (await createValidationPipe().transform(
          { division: 'RELAY_MEN', limit: '100', offset: '10000' },
          resultsMetadata,
        )) as ListResultsQueryDto;

        expect(result).toMatchObject({ limit: 100, offset: 10_000 });
      });
    });
  });
});
