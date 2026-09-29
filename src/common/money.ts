import type { Brand } from './brand.js';

export type Cents = Brand<number, 'Cents'>;

export function cents(value: number): Cents {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Cents must be a non-negative integer, received ${value}`);
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
    throw new Error(`Percent must be a finite number >= 0, received ${percent}`);
  }

  return cents(roundToWholeCents((amount * percent) / 100));
}
