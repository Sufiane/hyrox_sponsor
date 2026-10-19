import { InvalidValueError } from './domain-error';
import type { Brand } from './brand';

export type Cents = Brand<number, 'Cents'>;

export function cents(value: number): Cents {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidValueError('cents_invalid');
  }

  return value as Cents;
}

export function addCents(left: Cents, right: Cents): Cents {
  return cents(left + right);
}

function roundToWholeCents(value: number): number {
  return Math.floor(value);
}

function assertValidPercent(percent: number): void {
  if (!Number.isFinite(percent) || percent < 0) {
    throw new InvalidValueError('percent_invalid');
  }
}

export function percentOfCents(amount: Cents, percent: number): Cents {
  assertValidPercent(percent);

  return cents(roundToWholeCents((amount * percent) / 100));
}

export function ceilPercentOfCents(amount: Cents, percent: number): Cents {
  assertValidPercent(percent);

  return cents(Math.ceil((amount * percent) / 100));
}
