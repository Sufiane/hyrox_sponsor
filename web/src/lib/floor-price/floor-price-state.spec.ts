import { draftError, errorCopy, zoneStatesFromPrices } from './floor-price-state.ts';

describe('zoneStatesFromPrices', () => {
  const states = zoneStatesFromPrices([
    { zone: 'LEFT_PEC', floorPriceCents: 2500, isDefault: false },
    { zone: 'RIGHT_PEC', floorPriceCents: 1000, isDefault: true },
  ]);

  describe('when a price is saved', () => {
    it('badges the formatted price', () => {
      expect(states.LEFT_PEC).toEqual({ badge: '$25' });
    });
  });

  describe('when a price is the default', () => {
    it('badges the minimum', () => {
      expect(states.RIGHT_PEC).toEqual({ badge: '$10 (min)' });
    });
  });
});

describe('draftError', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['abc', 'invalid_amount'],
    ['10.5', 'invalid_amount'],
    ['9', 'floor_price_below_minimum'],
    ['10', null],
    ['100001', 'floor_price_above_maximum'],
  ])('maps %j to %j', (text, code) => {
    expect(draftError(text)).toBe(code);
  });
});

describe('errorCopy', () => {
  it.each([
    ['floor_price_below_minimum', 'Minimum floor price is $10.'],
    ['floor_price_above_maximum', 'Maximum floor price is $100000.'],
    ['floor_price_not_whole_dollars', 'Use whole dollars only, no cents.'],
    ['cents_invalid', 'That amount is not valid.'],
    ['validation_failed', 'That amount is not valid.'],
    ['not_authenticated', 'Sign in to save floor prices.'],
    ['invalid_amount', 'Enter a whole dollar amount, like 25.'],
    ['something_else', 'Could not save the floor price. Try again.'],
  ])('maps %s', (code, copy) => {
    expect(errorCopy(code)).toBe(copy);
  });
});
