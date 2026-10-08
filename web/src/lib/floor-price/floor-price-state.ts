import {
  MAXIMUM_FLOOR_PRICE_CENTS,
  PLATFORM_MINIMUM_FLOOR_PRICE_CENTS,
  floorPriceError,
  formatCents,
  parseWholeDollarsToCents,
} from '@hyrox-sponsor/shared/floor-price';
import type { FloorPriceErrorCode } from '@hyrox-sponsor/shared/floor-price';
import type { ZoneStates } from '../body-map/body-map-state.ts';
import type { FloorPriceView } from './floor-price-api.ts';

type KnownErrorCode =
  | FloorPriceErrorCode
  | 'cents_invalid'
  | 'validation_failed'
  | 'not_authenticated'
  | 'invalid_amount';

const MINIMUM_TEXT = formatCents(PLATFORM_MINIMUM_FLOOR_PRICE_CENTS);
const MAXIMUM_TEXT = formatCents(MAXIMUM_FLOOR_PRICE_CENTS);

const ERROR_COPY: Record<KnownErrorCode, string> = {
  floor_price_below_minimum: `Minimum floor price is ${MINIMUM_TEXT}.`,
  floor_price_above_maximum: `Maximum floor price is ${MAXIMUM_TEXT}.`,
  floor_price_not_whole_dollars: 'Use whole dollars only, no cents.',
  cents_invalid: 'That amount is not valid.',
  validation_failed: 'That amount is not valid.',
  not_authenticated: 'Sign in to save floor prices.',
  invalid_amount: 'Enter a whole dollar amount, like 25.',
};

const FALLBACK_COPY = 'Could not save the floor price. Try again.';

export function zoneStatesFromPrices(prices: FloorPriceView[]): ZoneStates {
  const states: ZoneStates = {};

  for (const price of prices) {
    const text = formatCents(price.floorPriceCents);

    states[price.zone] = { badge: price.isDefault ? `${text} (min)` : text };
  }

  return states;
}

export function draftError(text: string): string | null {
  if (text.trim() === '') {
    return null;
  }

  const cents = parseWholeDollarsToCents(text);

  if (cents == null) {
    return 'invalid_amount';
  }

  return floorPriceError(cents);
}

function isKnownErrorCode(code: string): code is KnownErrorCode {
  return Object.hasOwn(ERROR_COPY, code);
}

export function errorCopy(code: string): string {
  return isKnownErrorCode(code) ? ERROR_COPY[code] : FALLBACK_COPY;
}
