import { Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { InvalidValueError } from '../../common/domain-error';
import { createValidationPipe } from '../../common/validation-pipe';
import { RaceEntryParamsDto } from './race-entry-params.dto';

const metadata: ArgumentMetadata = { type: 'param', metatype: RaceEntryParamsDto };

describe('RaceEntryParamsDto', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the race entry id is valid', () => {
    it('exposes the trimmed branded id', async () => {
      const result = (await createValidationPipe().transform({ raceEntryId: ' entry_1 ' }, metadata)) as RaceEntryParamsDto;

      expect(result.raceEntryId).toBe('entry_1');
    });
  });

  describe('when the race entry id is blank', () => {
    it('rejects with the race_entry_id_invalid domain error', async () => {
      const result = createValidationPipe().transform({ raceEntryId: '  ' }, metadata);

      await expect(result).rejects.toThrow(InvalidValueError);
      await expect(result).rejects.toThrow('race_entry_id_invalid');
    });
  });
});
