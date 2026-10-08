import { cents } from '../common/money';
import {
  FLOOR_PRICE_STEP_CENTS,
  MAXIMUM_FLOOR_PRICE_CENTS,
  PLATFORM_MINIMUM_FLOOR_PRICE_CENTS,
} from './floor-price-limits';

describe('floor price limits', () => {
  describe('platform minimum', () => {
    it('is 1000 cents', () => {
      expect(PLATFORM_MINIMUM_FLOOR_PRICE_CENTS).toBe(1000);
    });
  });

  describe('maximum', () => {
    it('is 10_000_000 cents', () => {
      expect(MAXIMUM_FLOOR_PRICE_CENTS).toBe(10_000_000);
    });

    it('is a valid Cents value', () => {
      expect(cents(MAXIMUM_FLOOR_PRICE_CENTS)).toBe(MAXIMUM_FLOOR_PRICE_CENTS);
    });

    it('fits a Postgres INTEGER', () => {
      expect(MAXIMUM_FLOOR_PRICE_CENTS).toBeLessThanOrEqual(2_147_483_647);
    });
  });

  describe('step', () => {
    it('is 100 cents', () => {
      expect(FLOOR_PRICE_STEP_CENTS).toBe(100);
    });

    it('divides the minimum', () => {
      expect(PLATFORM_MINIMUM_FLOOR_PRICE_CENTS % FLOOR_PRICE_STEP_CENTS).toBe(0);
    });
  });
});
