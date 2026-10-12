import type { IanaTimezone } from './iana-timezone';

const MILLIS_PER_SECOND = 1000;

type WallPart = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

function partValue(parts: Intl.DateTimeFormatPart[], type: WallPart): number {
  return Number(parts.find((part) => part.type === type)?.value);
}

function wallClockAsUtc(instant: Date, timezone: IanaTimezone): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  return Date.UTC(
    partValue(parts, 'year'),
    partValue(parts, 'month') - 1,
    partValue(parts, 'day'),
    partValue(parts, 'hour'),
    partValue(parts, 'minute'),
    partValue(parts, 'second'),
  );
}

function offsetMillis(instant: Date, timezone: IanaTimezone): number {
  const whole = new Date(Math.floor(instant.getTime() / MILLIS_PER_SECOND) * MILLIS_PER_SECOND);

  return wallClockAsUtc(whole, timezone) - whole.getTime();
}

export function instantAtLocalMidnight(localDate: Date, timezone: IanaTimezone): Date {
  const wall = localDate.getTime();
  const first = new Date(wall - offsetMillis(new Date(wall), timezone));
  const second = new Date(wall - offsetMillis(first, timezone));

  if (wallClockAsUtc(second, timezone) === wall) {
    return second;
  }

  return new Date(Math.max(first.getTime(), second.getTime()));
}
