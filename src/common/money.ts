import type { Brand } from './brand.js';

export type Cents = Brand<number, 'Cents'>;

export function cents(value: number): Cents {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('cents_invalid');
  }

  return value as Cents;
}

export function addCents(left: Cents, right: Cents): Cents {
  return cents(left + right);
}

function roundToWholeCents(value: number): number {
  return Math.floor(value);
}

export function percentOfCents(amount: Cents, percent: number): Cents {
  if (!Number.isFinite(percent) || percent < 0) {
    throw new Error('percent_invalid');
  }

  return cents(roundToWholeCents((amount * percent) / 100));
}
