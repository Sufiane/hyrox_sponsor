import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe';
import { ZONE_ORDER } from '../zone-order';
import { ZoneParamDto } from './zone-param.dto';

const metadata: ArgumentMetadata = { type: 'param', metatype: ZoneParamDto };

describe('ZoneParamDto', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe.each([...ZONE_ORDER])('when the zone is %s', (zone) => {
    it('accepts it', async () => {
      const result = (await createValidationPipe().transform({ zone }, metadata)) as ZoneParamDto;

      expect(result.zone).toBe(zone);
    });
  });

  describe.each(['LEFT_ELBOW', 'left_pec', ''])('when the zone is "%s"', (zone) => {
    it('rejects with validation_failed', async () => {
      const result = createValidationPipe().transform({ zone }, metadata);

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow('validation_failed');
    });
  });
});
