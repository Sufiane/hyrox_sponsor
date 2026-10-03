import { ValidateBy } from 'class-validator';

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MIN_RACE_DATE = new Date('2017-01-01T00:00:00Z');
const MAX_YEARS_AHEAD = 2;

function hasValidCalendarParts(match: RegExpExecArray): boolean {
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part ?? 0));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59;
}

export function parseRaceInstant(value: unknown): Date | null {
  const match = typeof value === 'string' ? ISO_WITH_OFFSET.exec(value) : null;

  if (typeof value !== 'string' || match === null || !hasValidCalendarParts(match)) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function isRaceDateInRange(date: Date, now: Date): boolean {
  const latest = new Date(now);

  latest.setUTCFullYear(latest.getUTCFullYear() + MAX_YEARS_AHEAD);

  return date >= MIN_RACE_DATE && date <= latest;
}

export function IsRaceDateInRange(): PropertyDecorator {
  return ValidateBy({
    name: 'isRaceDateInRange',
    validator: {
      validate: (value: unknown): boolean => value instanceof Date && isRaceDateInRange(value, new Date()),
      defaultMessage: (): string => 'date must be between 2017-01-01 and two years from now',
    },
  });
}
