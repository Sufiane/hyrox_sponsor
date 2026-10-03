import { Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe';
import { InvalidValueError } from '../../common/domain-error';
import { AthleteParamsDto } from './athlete-params.dto';

const metadata: ArgumentMetadata = { type: 'param', metatype: AthleteParamsDto };

describe('AthleteParamsDto', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the athlete id is valid', () => {
    it('exposes the trimmed branded id', async () => {
      const result = (await createValidationPipe().transform({ athleteId: ' ath_1 ' }, metadata)) as AthleteParamsDto;

      expect(result.athleteId).toBe('ath_1');
    });
  });

  describe('when the athlete id is blank', () => {
    it('rejects with the athlete_id_invalid domain error', async () => {
      const result = createValidationPipe().transform({ athleteId: '  ' }, metadata);

      await expect(result).rejects.toThrow(InvalidValueError);
      await expect(result).rejects.toThrow('athlete_id_invalid');
    });
  });
});
