import { BadRequestException, Logger, type ArgumentMetadata } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe';
import { SetFloorPriceDto } from './set-floor-price.dto';

const metadata: ArgumentMetadata = { type: 'body', metatype: SetFloorPriceDto };

describe('SetFloorPriceDto', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('when the body has a numeric floorPriceCents', () => {
    it('accepts it', async () => {
      const result = (await createValidationPipe().transform({ floorPriceCents: 2500 }, metadata)) as SetFloorPriceDto;

      expect(result.floorPriceCents).toBe(2500);
    });
  });

  describe.each([
    ['floorPriceCents is missing', {}],
    ['floorPriceCents is a string', { floorPriceCents: '2500' }],
    ['the body has an extra property', { floorPriceCents: 2500, extra: true }],
  ])('when %s', (_title, body) => {
    it('rejects with validation_failed', async () => {
      const result = createValidationPipe().transform(body, metadata);

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow('validation_failed');
    });
  });
});
