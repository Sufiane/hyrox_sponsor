import { addCents, cents, percentOfCents } from './money.js';

describe('cents', () => {
  describe('when the value is a non-negative integer', () => {
    it('returns the value', () => {
      expect(cents(2500)).toBe(2500);
    });

    it('accepts zero', () => {
      expect(cents(0)).toBe(0);
    });
  });

  describe('when the value is negative', () => {
    it('throws', () => {
      expect(() => cents(-1)).toThrow('cents_invalid');
    });
  });

  describe('when the value is not an integer', () => {
    it('throws', () => {
      expect(() => cents(10.5)).toThrow('cents_invalid');
    });
  });

  describe('when the value is NaN', () => {
    it('throws', () => {
      expect(() => cents(Number.NaN)).toThrow('cents_invalid');
    });
  });

  describe('when the value is infinite', () => {
    it('throws', () => {
      expect(() => cents(Number.POSITIVE_INFINITY)).toThrow('cents_invalid');
    });
  });

  describe('when a plain number is used where Cents is required', () => {
    it('is rejected by the type checker', () => {
      // @ts-expect-error a plain number is not Cents
      const total: ReturnType<typeof cents> = 100;

      expect(total).toBe(100);
    });
  });
});

describe('addCents', () => {
  it('sums two amounts', () => {
    expect(addCents(cents(1000), cents(250))).toBe(1250);
  });
});

describe('percentOfCents', () => {
  describe('when the result is a whole number of cents', () => {
    it('returns the exact share', () => {
      expect(percentOfCents(cents(2000), 10)).toBe(200);
    });
  });

  describe('when the result has a fractional cent', () => {
    it('rounds down', () => {
      expect(percentOfCents(cents(3), 50)).toBe(1);
    });
  });

  describe('when the percent is zero', () => {
    it('returns zero', () => {
      expect(percentOfCents(cents(3), 0)).toBe(0);
    });
  });

  describe('when the percent is negative', () => {
    it('throws', () => {
      expect(() => percentOfCents(cents(100), -1)).toThrow('percent_invalid');
    });
  });

  describe('when the percent is NaN', () => {
    it('throws', () => {
      expect(() => percentOfCents(cents(100), Number.NaN)).toThrow('percent_invalid');
    });
  });

  describe('when the percent is infinite', () => {
    it('throws', () => {
      expect(() => percentOfCents(cents(100), Number.POSITIVE_INFINITY)).toThrow('percent_invalid');
    });
  });
});
