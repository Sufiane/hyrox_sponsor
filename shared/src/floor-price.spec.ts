import {
  FLOOR_PRICE_STEP_CENTS,
  MAXIMUM_FLOOR_PRICE_CENTS,
  PLATFORM_MINIMUM_FLOOR_PRICE_CENTS,
  floorPriceError,
  formatCents,
  parseWholeDollarsToCents,
} from './floor-price.ts';

describe('floor price constants', () => {
  it('matches the platform rules', () => {
    expect(PLATFORM_MINIMUM_FLOOR_PRICE_CENTS).toBe(1000);
    expect(MAXIMUM_FLOOR_PRICE_CENTS).toBe(10_000_000);
    expect(FLOOR_PRICE_STEP_CENTS).toBe(100);
  });
});

describe('parseWholeDollarsToCents', () => {
  describe('when the text is a whole dollar amount', () => {
    it.each([
      ['25', 2500],
      ['$25', 2500],
      [' 10 ', 1000],
      ['0', 0],
    ])('parses %j to %d cents', (text, cents) => {
      expect(parseWholeDollarsToCents(text)).toBe(cents);
    });
  });

  describe('when the text is not a whole dollar amount', () => {
    it.each(['', 'abc', '-5', '10.5', '10.00', '1e3', '1,000', '.', '$', '1'.repeat(30)])(
      'returns null for %j',
      (text) => {
        expect(parseWholeDollarsToCents(text)).toBeNull();
      },
    );
  });
});

describe('floorPriceError', () => {
  it.each([
    [999, 'floor_price_not_whole_dollars'],
    [900, 'floor_price_below_minimum'],
    [0, 'floor_price_below_minimum'],
    [1000, null],
    [10_000_000, null],
    [10_000_100, 'floor_price_above_maximum'],
  ])('maps %d cents to %j', (cents, code) => {
    expect(floorPriceError(cents)).toBe(code);
  });
});

describe('formatCents', () => {
  it.each([
    [2500, '$25'],
    [1000, '$10'],
  ])('formats %d cents as %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});
