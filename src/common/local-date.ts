import type { IanaTimezone } from './iana-timezone';

function partValue(parts: Intl.DateTimeFormatPart[], type: 'year' | 'month' | 'day'): number {
  const part = parts.find((candidate) => candidate.type === type);

  return Number(part?.value);
}

export function localDateInTimezone(instant: Date, timezone: IanaTimezone): Date {
  // Fixed calendar and digits so formatToParts never yields non-Gregorian years or non-Latin numerals.
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  return new Date(
    Date.UTC(partValue(parts, 'year'), partValue(parts, 'month') - 1, partValue(parts, 'day')),
  );
}
