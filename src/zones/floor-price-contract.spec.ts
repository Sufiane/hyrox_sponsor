import * as shared from '@hyrox-sponsor/shared/floor-price';
import * as backend from './floor-price-limits';

describe('floor price limits contract', () => {
  describe('when compared with the shared web constants', () => {
    it('has the same platform minimum', () => {
      expect(shared.PLATFORM_MINIMUM_FLOOR_PRICE_CENTS).toBe(backend.PLATFORM_MINIMUM_FLOOR_PRICE_CENTS);
    });

    it('has the same maximum', () => {
      expect(shared.MAXIMUM_FLOOR_PRICE_CENTS).toBe(backend.MAXIMUM_FLOOR_PRICE_CENTS);
    });

    it('has the same step', () => {
      expect(shared.FLOOR_PRICE_STEP_CENTS).toBe(backend.FLOOR_PRICE_STEP_CENTS);
    });
  });
});
