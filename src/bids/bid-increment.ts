import { addCents, ceilPercentOfCents, cents, type Cents } from '../common/money';

export const INCREMENT_FLAT_CENTS = cents(500);
export const INCREMENT_THRESHOLD_CENTS = cents(10_000);
export const INCREMENT_PERCENT = 5;
export const MAX_BID_CENTS = cents(100_000_000);

export function minimumIncrementCents(leader: Cents): Cents {
  if (leader < INCREMENT_THRESHOLD_CENTS) {
    return INCREMENT_FLAT_CENTS;
  }

  return ceilPercentOfCents(leader, INCREMENT_PERCENT);
}

export function minimumNextBidCents(leader: Cents | null, floor: Cents): Cents {
  if (leader === null) {
    return floor;
  }

  return addCents(leader, minimumIncrementCents(leader));
}
