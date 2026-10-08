export const PLATFORM_MINIMUM_FLOOR_PRICE_CENTS = 1000;
export const MAXIMUM_FLOOR_PRICE_CENTS = 10_000_000;
export const FLOOR_PRICE_STEP_CENTS = 100;

const MAX_DIGITS = 9;
const WHOLE_DOLLARS_PATTERN = /^\$?(\d+)$/;

export type FloorPriceErrorCode =
  'floor_price_not_whole_dollars' | 'floor_price_below_minimum' | 'floor_price_above_maximum';

export function parseWholeDollarsToCents(text: string): number | null {
  const match = WHOLE_DOLLARS_PATTERN.exec(text.trim());

  if (match == null || match[1].length > MAX_DIGITS) {
    return null;
  }

  return Number(match[1]) * FLOOR_PRICE_STEP_CENTS;
}

export function floorPriceError(cents: number): FloorPriceErrorCode | null {
  if (cents % FLOOR_PRICE_STEP_CENTS !== 0) {
    return 'floor_price_not_whole_dollars';
  }

  if (cents < PLATFORM_MINIMUM_FLOOR_PRICE_CENTS) {
    return 'floor_price_below_minimum';
  }

  if (cents > MAXIMUM_FLOOR_PRICE_CENTS) {
    return 'floor_price_above_maximum';
  }

  return null;
}

export function formatCents(cents: number): string {
  return `$${cents / FLOOR_PRICE_STEP_CENTS}`;
}
