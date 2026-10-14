import { InvalidValueError } from './domain-error';
import { MAX_FINISH_SECONDS, MIN_FINISH_SECONDS, seconds } from './seconds';

describe('seconds', () => {
  describe('when the value is within the finish-time bounds', () => {
    it.each([MIN_FINISH_SECONDS, 3_725, MAX_FINISH_SECONDS])('returns %d', (value) => {
      expect(seconds(value)).toBe(value);
    });
  });

  describe('when the value is not an integer', () => {
    it.each([1_800.5, Number.NaN, Number.POSITIVE_INFINITY])('throws seconds_invalid for %d', (value) => {
      expect(() => seconds(value)).toThrow(InvalidValueError);
      expect(() => seconds(value)).toThrow('seconds_invalid');
    });
  });

  describe('when the value is outside the bounds', () => {
    it.each([0, -5, MIN_FINISH_SECONDS - 1, MAX_FINISH_SECONDS + 1])(
      'throws finish_time_out_of_range for %d',
      (value) => {
        expect(() => seconds(value)).toThrow(InvalidValueError);
        expect(() => seconds(value)).toThrow('finish_time_out_of_range');
      },
    );
  });
});
